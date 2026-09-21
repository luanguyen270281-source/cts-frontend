// src/lib/api.js
// Lớp lưu trữ key-value (get/set/del) trên Supabase + đọc hóa đơn VAT (qua Edge Function).
// Mỗi "key" (sellers, departments, seller_info)
// là 1 dòng trong bảng app_storage, cột value (jsonb) chứa nguyên object/map.
// Hợp đồng (contracts) và Khách hàng (customers) lưu riêng (1 dòng = 1 bản ghi, có RLS theo người tạo).
// API Key Anthropic KHÔNG lưu ở app_storage nữa (đã từng lộ cho mọi user) — nay là Secret
// của Edge Function "clever-handler" trên Supabase, chỉ admin project mới cấu hình được.
import { supabase } from './supabase';
const TABLE = 'app_storage';
// Ảnh hóa đơn VAT lưu trong Supabase Storage (không lưu base64 trong Postgres nữa — cột jsonb
// vat_invoice_image trên bảng contracts giờ chỉ chứa { path, mediaType }, ảnh thật nằm ở bucket này).
const VAT_INVOICE_BUCKET = 'vat-invoices';

function mediaTypeToExt(mediaType) {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  return map[mediaType] || 'bin';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (ev) => resolve(ev.target.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function base64ToBlob(base64, mediaType) {
  const res = await fetch(`data:${mediaType};base64,${base64}`);
  return res.blob();
}
// 9 cột theo dõi hồ sơ "SALE GỬI / NHÂN SỰ GỬI / KẾ TOÁN NHẬN HỒ SƠ / KẾ TOÁN NHẬN HỢP ĐỒNG"
// trên bảng invoice_goods.
const INVOICE_GOODS_WORKFLOW_FIELDS = [
  'sale_sent', 'sale_sent_date',
  'hr_sent', 'hr_sent_date',
  'accounting_received', 'accounting_received_date',
  'accounting_contract_received', 'accounting_contract_received_date',
  'deadline_days',
];
export const api = {
  // ───────── Key-Value storage (Supabase) ─────────
  async get(key, _shared = false) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? data.value : null;
  },
  async set(key, value, _shared = false) {
    const { error } = await supabase
      .from(TABLE)
      .upsert(
        { key, value, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    if (error) throw new Error(error.message);
    return value;
  },
  async del(key, _shared = false) {
    const { error } = await supabase.from(TABLE).delete().eq('key', key);
    if (error) throw new Error(error.message);
  },
  // ───────── AI đọc hóa đơn VAT (gọi qua Edge Function — API Key chỉ nằm ở server) ─────────
  async readVAT(imageBase64, mediaType) {
    return api._invokeReadInvoice(imageBase64, mediaType, 'vat');
  },

  // ───────── AI đọc danh sách hàng hóa định giá USD (gọi qua Edge Function) ─────────
  async readGoodsUSD(imageBase64, mediaType) {
    return api._invokeReadInvoice(imageBase64, mediaType, 'goods_usd');
  },

  // ───────── AI dịch mô tả sản phẩm tiếng Việt → tiếng Anh (dùng cho Sales Contract) ─────────
  async translateGoodsDescription(vietnameseText) {
    const { data, error } = await supabase.functions.invoke('clever-handler', {
      body: { text: vietnameseText, mode: 'translate_en' },
    });
    if (error) {
      let msg = error.message;
      try {
        const body = await error.context?.json();
        if (body?.error) msg = body.error;
      } catch { /* ignore */ }
      throw new Error(msg || 'Lỗi gọi AI dịch mô tả.');
    }
    if (data?.error) throw new Error(data.error);
    return data.en || ''; // { en: "..." }
  },

  // ───────── AI dịch địa chỉ tiếng Việt → tiếng Anh (dùng cho Sales Contract) ─────────
  async translateAddressToEnglish(vietnameseAddress) {
    const { data, error } = await supabase.functions.invoke('clever-handler', {
      body: { text: vietnameseAddress, mode: 'translate_address_en' },
    });
    if (error) {
      let msg = error.message;
      try {
        const body = await error.context?.json();
        if (body?.error) msg = body.error;
      } catch { /* ignore */ }
      throw new Error(msg || 'Lỗi gọi AI dịch địa chỉ.');
    }
    if (data?.error) throw new Error(data.error);
    return data.en || ''; // { en: "..." }
  },

  async _invokeReadInvoice(imageBase64, mediaType, mode) {
    const { data, error } = await supabase.functions.invoke('clever-handler', {
      body: { imageBase64, mediaType, mode },
    });
    if (error) {
      // Thử đọc message lỗi cụ thể do Edge Function trả về (thay vì lỗi chung "non-2xx status code")
      let msg = error.message;
      try {
        const body = await error.context?.json();
        if (body?.error) msg = body.error;
      } catch { /* ignore */ }
      throw new Error(msg || 'Lỗi gọi AI đọc hóa đơn.');
    }
    if (data?.error) throw new Error(data.error);
    return data; // { goods: [...] }
  },

  // ───────── Hợp đồng (bảng contracts, RLS theo người tạo) ─────────
  // Danh sách hợp đồng có tìm kiếm/lọc/phân trang ngay ở server — dùng cho ContractListPage,
  // thay cho việc tải hết rồi lọc ở trình duyệt (giống hệt cách list_invoice_goods_paged đã làm).
  async listContractsPaged({ type, search = '', seller = '', dateFrom = '', dateTo = '', limit = 30, offset = 0 } = {}) {
    const { data, error } = await supabase.rpc('list_contracts_paged', {
      p_type: type,
      p_search: search || null,
      p_seller: seller || null,
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw new Error(error.message);
    const rows = data || [];
    return { rows, totalCount: Number(rows[0]?.total_count ?? 0) };
  },

  // Số đếm theo loại (Sidebar + Dashboard) + 8 hợp đồng gần nhất, 1 lần gọi duy nhất
  async contractsDashboardStats() {
    const { data, error } = await supabase.rpc('contracts_dashboard_stats');
    if (error) throw new Error(error.message);
    return data?.[0] || null;
  },

  // Kiểm tra trùng số hợp đồng — TOÀN CÔNG TY (mọi sale), không chỉ trong phạm vi hợp đồng của người đang đăng nhập
  async contractIdExists(contractId) {
    const { data, error } = await supabase.rpc('contract_id_exists', { p_contract_id: contractId });
    if (error) throw new Error(error.message);
    return !!data;
  },

  // Danh sách nhẹ toàn bộ hợp đồng 1 loại (dùng để gắn HĐNT/ĐĐH cha khi tạo ĐĐH/BBBG) — tự phân trang
  // để không bị cắt ở 1000 dòng (loại HĐNT/ĐĐH mua bán đã vượt 1000 dòng thật).
  async searchRelatedContracts(type) {
    const PAGE = 1000;
    let all = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase.rpc('search_related_contracts', { p_type: type }).range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      all = all.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
    return all;
  },

  // Tìm các hợp đồng con đang tham chiếu 1 số hợp đồng cha (dùng khi đổi số HĐNT/ĐĐH) — TOÀN CÔNG TY
  async findContractsReferencing(refKey, oldId) {
    const { data, error } = await supabase.rpc('find_contracts_referencing', { p_ref_key: refKey, p_old_id: oldId });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async getContractFull(dbId) {
    // Load toàn bộ dữ liệu hợp đồng khi bấm Xem — ghép ngược vat_invoice_image (cột riêng) vào
    // data.vatInvoiceImage để phần hiển thị (ContractViewer, previews...) dùng y như cũ, không cần đổi.
    const { data: row, error } = await supabase.from('contracts').select('*').eq('id', dbId).single();
    if (error) throw new Error(error.message);
    if (row.vat_invoice_image?.path) {
      // Ảnh đã migrate sang Storage — tải về và giải mã lại thành base64 ngay tại đây (không dùng
      // signed/public URL) để html2canvas/html2pdf.js và html-docx-js (xuất PDF/Word) vẫn nhúng được
      // ảnh trực tiếp vào file xuất ra, không phụ thuộc 1 URL còn sống hay đã hết hạn.
      const { data: blob, error: downloadError } = await supabase.storage
        .from(VAT_INVOICE_BUCKET)
        .download(row.vat_invoice_image.path);
      if (downloadError) {
        console.error('Không tải được ảnh hóa đơn VAT từ Storage:', downloadError.message);
      } else {
        const base64 = await blobToBase64(blob);
        row.data = { ...row.data, vatInvoiceImage: { data: base64, mediaType: row.vat_invoice_image.mediaType } };
      }
    } else if (row.vat_invoice_image?.data) {
      // Legacy — ảnh chưa migrate, vẫn còn nằm thẳng trong jsonb như trước.
      row.data = { ...row.data, vatInvoiceImage: row.vat_invoice_image };
    }
    return row;
  },

  async upsertContract({ _dbId, category, docType, contract, maSale }) {
    // vatInvoiceImage (ảnh hóa đơn base64) tách ra cột riêng `vat_invoice_image`, KHÔNG nhúng trong jsonb `data` nữa —
    // vì cùng 1 cột jsonb nặng (do ảnh) khiến Postgres phải giải nén toàn bộ mỗi lần đọc dù chỉ cần vài field nhẹ,
    // làm list_contracts_slim chậm hẳn dù đã cố lọc bỏ field này khỏi kết quả trả về.
    const { vatInvoiceImage, ...restContract } = contract;
    let vatInvoiceImageColumn = null;
    if (vatInvoiceImage?.data) {
      // Ảnh mới chọn (base64 trong state) — upload lên Storage, cột DB chỉ lưu path.
      // Path = uuid ngẫu nhiên (không dùng id hợp đồng) — sinh được ngay cả khi hợp đồng chưa có id
      // (trường hợp tạo mới), không cần ghi 2 lần (insert rồi mới update lại path).
      const path = `${crypto.randomUUID()}.${mediaTypeToExt(vatInvoiceImage.mediaType)}`;
      const blob = await base64ToBlob(vatInvoiceImage.data, vatInvoiceImage.mediaType);
      const { error: uploadError } = await supabase.storage
        .from(VAT_INVOICE_BUCKET)
        .upload(path, blob, { contentType: vatInvoiceImage.mediaType });
      if (uploadError) throw new Error('Lỗi upload ảnh hóa đơn VAT: ' + uploadError.message);
      vatInvoiceImageColumn = { path, mediaType: vatInvoiceImage.mediaType };
    } else if (vatInvoiceImage?.path) {
      // Đã là path Storage sẵn (không xảy ra trong luồng hiện tại vì getContractFull luôn trả base64,
      // nhưng xử lý phòng hờ) — giữ nguyên, không upload lại.
      vatInvoiceImageColumn = vatInvoiceImage;
    }
    const payload = {
      category, doc_type: docType,
      contract_id: contract.contractId,
      data: restContract,
      vat_invoice_image: vatInvoiceImageColumn,
      updated_at: new Date().toISOString(),
    };
    if (_dbId) {
      const { data, error } = await supabase
        .from('contracts').update(payload).eq('id', _dbId).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    const { data: s } = await supabase.auth.getSession();
    payload.created_by = s.session?.user?.id;
    payload.ma_sale = maSale;
    const { data, error } = await supabase
      .from('contracts').insert(payload).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  // Cập nhật nhanh 1-vài field nhẹ trong data jsonb (VD: sửa điều khoản ngay ở màn Xem) — không đi qua
  // upsertContract vì hàm đó thấy contract.vatInvoiceImage (base64 tải lại từ getContractFull) sẽ tưởng
  // là ảnh mới rồi upload lại lên Storage mỗi lần lưu, rác dần Storage với ảnh y hệt nhau.
  async patchContractData(dbId, patch) {
    const { data: row, error: readError } = await supabase.from('contracts').select('data').eq('id', dbId).single();
    if (readError) throw new Error(readError.message);
    const { error } = await supabase.from('contracts')
      .update({ data: { ...row.data, ...patch }, updated_at: new Date().toISOString() })
      .eq('id', dbId);
    if (error) throw new Error(error.message);
  },

  async deleteContractRow(dbId) {
    // Dọn ảnh trong Storage trước khi xóa row (nếu đã migrate) — không throw nếu lỗi, chỉ log,
    // để 1 lỗi Storage không chặn được việc xóa hợp đồng.
    const { data: row } = await supabase.from('contracts').select('vat_invoice_image').eq('id', dbId).single();
    if (row?.vat_invoice_image?.path) {
      const { error: removeError } = await supabase.storage.from(VAT_INVOICE_BUCKET).remove([row.vat_invoice_image.path]);
      if (removeError) console.error('Không xóa được ảnh hóa đơn VAT trong Storage:', removeError.message);
    }
    const { error } = await supabase.from('contracts').delete().eq('id', dbId);
    if (error) throw new Error(error.message);
  },

  // "Kế toán nhận Hợp đồng" — chỉ dùng cho 3 màn HĐ Nguyên Tắc. Cột accounting_received nằm ở
  // cấp cột thật trên bảng contracts (không phải trong jsonb "data"), nên list_contracts_paged
  // (RPC) không trả về — phải lấy riêng bằng 1 lệnh gọi nhẹ theo id, giống hệt cách InvoiceGoodsPage
  // lấy 9 cột theo dõi hồ sơ qua getInvoiceGoodsExtraMap.
  async getContractsAccountingMap(ids) {
    if (!ids || ids.length === 0) return {};
    const { data, error } = await supabase.from('contracts').select('id, accounting_received').in('id', ids);
    if (error) throw new Error(error.message);
    const map = {};
    (data || []).forEach(r => { map[r.id] = !!r.accounting_received; });
    return map;
  },

  async updateContractAccountingReceived(dbId, value) {
    const { error } = await supabase.from('contracts').update({ accounting_received: value }).eq('id', dbId);
    if (error) throw new Error(error.message);
  },

  // Giao hợp đồng cho sale khác (chỉ admin) — chỉ cập nhật ma_sale, không đổi người tạo
  async assignContractSale(dbId, newMaSale) {
    const { data, error } = await supabase
      .from('contracts')
      .update({ ma_sale: newMaSale, updated_at: new Date().toISOString() })
      .eq('id', dbId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  // ───────── Khách hàng (bảng customers, RLS theo người tạo) ─────────
  async listCustomers() {
    // Supabase mặc định chỉ trả tối đa 1000 dòng/lần — phải tự phân trang để lấy đủ toàn bộ
    const PAGE = 1000;
    let all = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('customers').select('*').order('created_at', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      all = all.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
    return all;
  },

  async upsertCustomer({ _dbId, customerId, data, maSale }) {
    const payload = { customer_id: customerId, data, ma_sale: maSale, updated_at: new Date().toISOString() };
    if (_dbId) {
      const { data: row, error } = await supabase
        .from('customers').update(payload).eq('id', _dbId).select().single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: s } = await supabase.auth.getSession();
    payload.created_by = s.session?.user?.id;
    const { data: row, error } = await supabase
      .from('customers').insert(payload).select().single();
    if (error) throw new Error(error.message);
    return row;
  },

  async deleteCustomerRow(dbId) {
    const { error } = await supabase.from('customers').delete().eq('id', dbId);
    if (error) throw new Error(error.message);
  },

  // ───────── Hồ sơ người dùng ─────────
  async getMyProfile() {
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user?.id;
    if (!uid) return null;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },

  async updateProfile(id, fields) {
    const { data, error } = await supabase
      .from('profiles').update(fields).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  // ───────── Quản lý tài khoản (chỉ admin) ─────────
  async adminListProfiles() {
    // Dùng direct query thay vì RPC để tự động lấy đủ các cột mới (approved, phone...)
    // kể cả khi cột được thêm sau khi RPC đã được tạo.
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('approved', { ascending: true })
      .order('full_name', { ascending: true, nullsFirst: true });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async adminDeleteUser(userId) {
    // Xóa auth user (user record trong Supabase Auth) qua Edge Function hoặc trực tiếp profile
    // Vì client-side không thể xóa auth.users, ta xóa profile trước → user sẽ không đăng nhập được,
    // admin có thể vào Supabase dashboard để xóa auth user nếu cần hoàn toàn.
    const { error } = await supabase.from('profiles').delete().eq('id', userId);
    if (error) throw new Error(error.message);
  },

  // --- Invoice Goods: hàng hóa theo số hóa đơn (nhập từ Excel), dùng để tự điền khi tạo ĐĐH/BBBG ---
  // Dùng RPC phân trang + lọc server-side thay vì tải hết bảng (đã lên tới hàng chục nghìn dòng,
  // select('*') trần khiến supabase-js tự động lặp request 1000 dòng/lần để lấy hết → rất chậm).
  async listInvoiceGoodsPaged({ search = '', seller = '', sale = '', dateFrom = '', dateTo = '', accountingReceived = null, limit = 50, offset = 0 } = {}) {
    const { data, error } = await supabase.rpc('list_invoice_goods_paged', {
      p_search: search || null,
      p_seller: seller || null,
      p_sale: sale || null,
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
      p_accounting_received: accountingReceived,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw new Error(error.message);
    const rows = data || [];
    return { rows, totalCount: rows[0]?.total_count ?? 0 };
  },

  async invoiceGoodsFilterOptions() {
    const { data, error } = await supabase.rpc('list_invoice_goods_filter_options');
    if (error) throw new Error(error.message);
    const row = data?.[0] || {};
    return { sellers: row.sellers || [], sales: row.sales || [] };
  },

  // Tìm kiếm nhẹ (tối đa ~50 kết quả) dùng cho InvoiceGoodsPicker khi tạo ĐĐH/BBBG.
  // 50 thay vì 20 (cũ) — bảng invoice_goods đã hàng chục nghìn dòng, từ khóa chung
  // chung (VD trùng tên khách hàng) rất dễ khớp hơn 20 hóa đơn và bị cắt mất phần còn lại.
  async searchInvoiceGoods(query, limit = 50) {
    const { data, error } = await supabase.rpc('search_invoice_goods', { p_query: query || null, p_limit: limit });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async upsertInvoiceGoodsBatch(rows) {
    const { data: s } = await supabase.auth.getSession();
    const payload = rows.map(r => ({ ...r, created_by: s.session?.user?.id, updated_at: new Date().toISOString() }));
    const { data, error } = await supabase
      .from('invoice_goods')
      .upsert(payload, { onConflict: 'group_key' })
      .select();
    if (error) throw new Error(error.message);
    return data || [];
  },

  async deleteInvoiceGoods(id) {
    const { error } = await supabase.from('invoice_goods').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  async updateInvoiceGoodsNote(id, note) {
    const { error } = await supabase.from('invoice_goods').update({ note }).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async updateInvoiceGoodsInvoiceNote(id, invoice_note) {
    const { error } = await supabase.from('invoice_goods').update({ invoice_note }).eq('id', id);
    if (error) throw new Error(error.message);
  },

  // Cập nhật 1 cột trong nhóm "theo dõi hồ sơ SALE GỬI / NHÂN SỰ GỬI / KẾ TOÁN NHẬN" — Sale (không
  // chỉ Admin) sửa được, nhưng có policy + trigger riêng trong Supabase chặn non-admin sửa các
  // cột invoice_goods khác (số tiền, hàng hóa...). Whitelist tên cột để tránh nhận field
  // lạ từ UI (không phải để chặn quyền — quyền đã do DB tự lo).
  async updateInvoiceGoodsWorkflowField(id, field, value) {
    if (!INVOICE_GOODS_WORKFLOW_FIELDS.includes(field)) throw new Error('Cột không hợp lệ: ' + field);
    const { error } = await supabase.from('invoice_goods').update({ [field]: value }).eq('id', id);
    if (error) throw new Error(error.message);
  },

  // Lấy 9 cột theo dõi hồ sơ + "Ghi chú hóa đơn" cho 1 loạt id, trong 1 lần gọi Supabase duy nhất.
  // → trả về { [id]: { sale_sent, sale_sent_date, ..., invoice_note } }
  async getInvoiceGoodsExtraMap(ids) {
    if (!ids || ids.length === 0) return {};
    const { data, error } = await supabase.from('invoice_goods')
      .select(`id, invoice_note, ${INVOICE_GOODS_WORKFLOW_FIELDS.join(', ')}`).in('id', ids);
    if (error) throw new Error(error.message);
    const map = {};
    (data || []).forEach(r => { const { id, ...rest } = r; map[id] = rest; });
    return map;
  },

  // Lấy số đề nghị thanh toán kế tiếp — do Supabase cấp phát (sequence), đảm bảo luôn tăng dần
  // và không bao giờ trùng, không phụ thuộc vào dữ liệu đã tải sẵn ở trình duyệt.
  async getNextPaymentRequestNo() {
    const { data, error } = await supabase.rpc('get_next_payment_request_no');
    if (error) throw new Error(error.message);
    return data;
  },

  async deleteInvoiceGoodsMany(ids) {
    const { error } = await supabase.from('invoice_goods').delete().in('id', ids);
    if (error) throw new Error(error.message);
  },

  // --- Cash Flow Batches: theo dõi dòng tiền theo từng lô hàng ---
  async listCashFlowBatches() {
    const PAGE = 1000;
    let all = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('cash_flow_batches').select('*').order('order_date', { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      all = all.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
    return all;
  },

  async upsertCashFlowBatch(id, fields) {
    const { data: s } = await supabase.auth.getSession();
    const payload = { ...fields, updated_at: new Date().toISOString() };
    if (id) {
      const { data, error } = await supabase
        .from('cash_flow_batches').update(payload).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    payload.created_by = s.session?.user?.id;
    const { data, error } = await supabase
      .from('cash_flow_batches').insert(payload).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async deleteCashFlowBatch(id) {
    const { error } = await supabase.from('cash_flow_batches').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // --- Hợp đồng ngoại thương: bảng lô hàng RIÊNG, độc lập hoàn toàn với cash_flow_batches (Thanh toán hộ) —
  // dùng lại y hệt cấu trúc/luồng Theo dõi dòng tiền + Đề Nghị Thanh Toán nhưng cho 1 mảng dữ liệu khác. ---
  async listFxContractBatches() {
    const PAGE = 1000;
    let all = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('fx_contract_batches').select('*').order('order_date', { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      all = all.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
    return all;
  },

  async upsertFxContractBatch(id, fields) {
    const { data: s } = await supabase.auth.getSession();
    const payload = { ...fields, updated_at: new Date().toISOString() };
    if (id) {
      const { data, error } = await supabase
        .from('fx_contract_batches').update(payload).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    payload.created_by = s.session?.user?.id;
    const { data, error } = await supabase
      .from('fx_contract_batches').insert(payload).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async deleteFxContractBatch(id) {
    const { error } = await supabase.from('fx_contract_batches').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // --- Sales Contract: hợp đồng ngoại thương tiếng Anh (Seller nhà máy TQ tự do nhập / Buyer = khách hàng),
  // bảng RIÊNG hoàn toàn, độc lập với contracts (HĐNT/ĐĐH/BBBG) và cash_flow_batches/fx_contract_batches. ---
  async listSalesContracts() {
    const PAGE = 1000;
    let all = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('sales_contracts').select('*').order('date', { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      all = all.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
    return all;
  },

  async upsertSalesContract(id, fields) {
    const { data: s } = await supabase.auth.getSession();
    const payload = { ...fields, updated_at: new Date().toISOString() };
    if (id) {
      const { data, error } = await supabase
        .from('sales_contracts').update(payload).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    payload.created_by = s.session?.user?.id;
    const { data, error } = await supabase
      .from('sales_contracts').insert(payload).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async deleteSalesContract(id) {
    const { error } = await supabase.from('sales_contracts').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // --- Quỹ ngoại tệ (CNY): sổ quỹ riêng theo dõi Thu vào quỹ / Chi trả cho từng lô hàng ---
  async listCnyFundTransactions() {
    const { data, error } = await supabase
      .from('cny_fund_transactions').select('*').order('date', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async upsertCnyFundTransaction(id, fields) {
    const { data: s } = await supabase.auth.getSession();
    const payload = { ...fields };
    if (id) {
      const { data, error } = await supabase
        .from('cny_fund_transactions').update(payload).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    payload.created_by = s.session?.user?.id;
    const { data, error } = await supabase
      .from('cny_fund_transactions').insert(payload).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async deleteCnyFundTransaction(id) {
    const { error } = await supabase.from('cny_fund_transactions').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};
