// File: src/pages/PaymentRequestPrint.jsx
// Giấy Đề Nghị Thanh Toán — vừa là màn nhập liệu thật (lưu ngược vào bảng lô hàng), vừa in ra giấy.
import { useState, useEffect, useRef } from 'react';
import { fmtNum, numberToWords, formatThousands } from '../helpers';
import { buildCustomerOptions, parseCustomerOptionValue, encodeCustomerOptionValue } from '../utils/customerOptions';
import { SearchableSelect } from '../components/SearchableSelect';
import { api } from '../lib/api';

const PRINT_STYLE = `
  @page { size: A4 portrait; margin: 12mm 15mm 12mm 25mm; }
  body { font-family: 'Times New Roman', serif; font-size: 11.5pt; line-height: 1.3; background: #fff; color: #000; margin: 0; padding: 0; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #000; padding: 2px 5px; }
  th { text-align: center; font-weight: bold; }
  .no-print { display: none !important; }
  .no-border td, .no-border { border: none !important; padding: 1px 0 !important; }
  .quoc-hieu { font-size: 12pt; font-weight: bold; text-align: center; }
  .tieu-ngu { font-size: 13pt; font-weight: bold; text-align: center; }
  .doc-title { font-size: 15pt; font-weight: bold; text-align: center; text-transform: uppercase; letter-spacing: 0.5px; }
  p { margin: 4px 0; }
  tr { page-break-inside: avoid !important; break-inside: avoid !important; }
  thead { display: table-header-group; }
`;

// Lấy ngày hôm nay theo GIỜ ĐỊA PHƯƠNG (VN), KHÔNG dùng toISOString() vì hàm đó trả giờ UTC —
// làm việc sau 17h giờ VN thì UTC vẫn là hôm trước, gây lùi 1 ngày.
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtDateVN = (d) => {
  if (!d) return '';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
};

const blankVoucherRow = () => ({ id: null, dienGiai: '', ctsPhaiThu: '', daThuKhach: '', tyGiaRow: '', tienHangRow: '' });
const blankFxRow = () => ({ id: null, noiDung: '', tyGia: '', soTe: '' });

// Ô nhập số hiển thị có dấu chấm phân cách hàng nghìn (VD: 1.000.000) ngay khi gõ.
// allowDecimal=true (dùng cho Số tệ) cho phép gõ cả số thập phân, không tự format dấu phân cách khi đang gõ.
const MoneyInput = ({ value, onChange, className, allowDecimal = false }) => {
  if (allowDecimal) {
    // Hiện dấu chấm phân cách hàng nghìn ở phần nguyên, dấu phẩy cho phần thập phân (kiểu VN) —
    // vẫn lưu giá trị chuẩn (dùng dấu chấm cho thập phân) để tính toán không bị sai.
    const display = (() => {
      if (value === '' || value === null || value === undefined) return '';
      const [intPart, decPart] = String(value).split('.');
      const withThousands = intPart === '' ? '' : formatThousands(intPart);
      return decPart !== undefined ? `${withThousands},${decPart}` : withThousands;
    })();
    return (
      <input
        type="text" inputMode="decimal" value={display}
        onChange={(e) => {
          // Dấu CHẤM = phân cách hàng nghìn (bỏ đi), chỉ dấu PHẨY mới là thập phân (kiểu VN).
          // Nhờ vậy gõ "300.000.000" ra đúng 300 triệu, còn "8,5" ra đúng 8.5.
          let raw = e.target.value.replace(/\./g, '').replace(/[^0-9,]/g, '');
          const parts = raw.split(',');
          const intPart = parts[0] || '';
          const decPart = parts.length > 1 ? parts.slice(1).join('') : undefined;
          onChange(decPart !== undefined ? `${intPart}.${decPart}` : intPart);
        }}
        className={className}
      />
    );
  }
  const display = value === '' || value === null || value === undefined ? '' : formatThousands(value);
  return (
    <input
      type="text" inputMode="numeric" value={display}
      onChange={(e) => { const raw = e.target.value.replace(/\D/g, ''); onChange(raw === '' ? '' : raw); }}
      className={className}
    />
  );
};

export const PaymentRequestPrint = ({ customerId: initialCustomerId, customer: initialCustomer, batches: initialBatches, requestNo = null, batchIds = null, docLabel = '', customers = {}, sellers = {}, myName = '', myPhone = '', onSave, onDelete, onSelectCustomer, onClose }) => {
  const [customerId, setCustomerId] = useState(initialCustomerId || '');
  const [branchIndex, setBranchIndex] = useState(null); // null = đang dùng thông tin Mã gốc, không phải nhánh nào
  const customer = customers[customerId] || initialCustomer;
  const selectedBranch = branchIndex != null ? customer?.branches?.[branchIndex] : null;
  // Tên/thông tin hiển thị: nếu đã chọn 1 nhánh cụ thể thì dùng đúng tên của nhánh đó, không phải tên gốc.
  const displayCustomerName = selectedBranch?.companyName || customer?.companyName || '';
  const isFx = docLabel === 'Hợp Đồng Ngoại Thương'; // các thay đổi riêng chỉ áp dụng cho luồng này, không đụng tới ĐNTT Thanh Toán Hộ
  // Nếu mở từ 1 dòng/nhóm cụ thể (bấm vào số ở bảng Theo dõi), CHỈ lấy đúng các lô có ID nằm trong batchIds —
  // xác định chính xác theo ID, KHÔNG so khớp theo giá trị Số đề nghị TT nữa (vì 2 đề nghị khác nhau vẫn có thể
  // trùng số — nếu lọc theo số sẽ gộp nhầm, sửa 1 đề nghị lại làm nhảy số đề nghị kia).
  const batchesOfCustomer = (initialBatches && customerId)
    ? initialBatches.filter(b => b.customer_id === customerId && (batchIds ? batchIds.includes(b.id) : (requestNo == null || String(b.payment_request_no ?? '') === String(requestNo))))
        // Danh sách trong bộ nhớ có lô mới lưu nằm TRƯỚC — sắp lại cũ→mới để mở ra đúng thứ tự đã nhập.
        .slice().sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    : [];

  const [requestDate, setRequestDate] = useState(todayISO());
  const [saleName, setSaleName] = useState(myName);
  const [salePhone, setSalePhone] = useState(myPhone);

  const [sellerId, setSellerId] = useState('');
  const [receiveAccount, setReceiveAccount] = useState('');
  const [bankName, setBankName] = useState('');
  const [note, setNote] = useState('');
  const [voucherRows, setVoucherRows] = useState([blankVoucherRow()]);
  const [fxRows, setFxRows] = useState([blankFxRow()]);
  const [saving, setSaving] = useState(false);

  const num = (v) => Number(v) || 0;

  // Số đề nghị thanh toán giờ NHẬP TAY hoàn toàn — không tự sinh/tự nhảy nữa.
  // Nếu mở lại 1 đề nghị có sẵn, ô này được điền sẵn đúng số cũ (vẫn có thể sửa lại nếu cần).
  const [requestNoInput, setRequestNoInput] = useState('');

  // Những giá trị đã lưu của đề nghị đang mở — dùng lúc lưu để CHỈ ghi đè Ghi chú/Ngày khi người dùng thực sự đổi,
  // và giữ nguyên request_id chung của các lô cùng 1 đề nghị.
  const loadedRef = useRef({ note: '', date: '', requestId: null });

  // Nếu mở kèm sẵn danh sách lô của khách (đến từ nút "In DNTT" hoặc bấm số đề nghị) — dựng lại ĐÚNG giấy đề nghị:
  // mỗi lô có thể chứa 1 dòng chứng từ, 1 dòng ngoại tệ, hoặc cả hai; 2 bảng được dựng riêng, mỗi dòng nhớ id lô của nó.
  useEffect(() => {
    if (batchesOfCustomer.length > 0) {
      // Lô có "phần chứng từ" khi có số tiền chứng từ (lưu chứng từ luôn ghi deposit_vnd/customer_paid_total ≠ null).
      // KHÔNG dựa vào goods_desc: lô chỉ có ngoại tệ (dòng ngoại tệ thừa) cũng từng bị lưu nội dung vào goods_desc —
      // nếu coi đó là dòng chứng từ thì 1 đơn có 3 khoản sẽ "tự chia thành 3 dòng chứng từ" mỗi lần mở lại.
      const hasFxPart = (b) => isFx ? !!(b.fx_content || b.fx_exchange_rate != null || b.amount_cny != null) : !!(b.fx_content || b.exchange_rate != null || b.amount_cny != null);
      // Lô cũ chỉ có mô tả (không số tiền, không ngoại tệ) vẫn là dòng chứng từ, không được ẩn đi.
      const hasVoucherPart = (b) => b.deposit_vnd != null || b.customer_paid_total != null || b.voucher_exchange_rate != null || b.voucher_amount_fx != null
        || (!hasFxPart(b) && !!b.goods_desc);
      // Lô chỉ có ngoại tệ (kể cả dữ liệu cũ): nội dung ngoại tệ đang nằm trong goods_desc
      const fxOnlyContent = (b) => (hasVoucherPart(b) ? '' : (b.goods_desc || ''));
      const vRows = batchesOfCustomer.filter(hasVoucherPart).map(b => ({
        id: b.id, dienGiai: b.goods_desc || '', ctsPhaiThu: isFx ? (b.deposit_vnd ?? '') : '',
        daThuKhach: isFx ? (b.customer_paid_total ?? '') : ((num(b.customer_paid_total) + num(b.deposit_vnd)) || ''),
        tyGiaRow: isFx ? (b.voucher_exchange_rate ?? '') : '', tienHangRow: isFx ? (b.voucher_amount_fx ?? '') : '',
        orig: isFx ? String(b.customer_paid_total ?? '') : '',
      }));
      const fRows = batchesOfCustomer.filter(hasFxPart).map(b => ({
        id: b.id, noiDung: (b.fx_content || '') || fxOnlyContent(b),
        tyGia: isFx ? (b.fx_exchange_rate ?? '') : (b.exchange_rate ?? ''), soTe: b.amount_cny ?? '',
      }));
      setVoucherRows(vRows.length ? vRows : [blankVoucherRow()]);
      setFxRows(fRows.length ? fRows : [blankFxRow()]);
      const firstBank = batchesOfCustomer.find(b => b.bank_account);
      if (firstBank) { setReceiveAccount(firstBank.bank_account || ''); setBankName(firstBank.bank_name || ''); }
      if (batchesOfCustomer[0]?.seller_id) setSellerId(batchesOfCustomer[0].seller_id);
      const existingReqNo = batchesOfCustomer.find(b => b.payment_request_no != null)?.payment_request_no;
      if (existingReqNo != null) setRequestNoInput(String(existingReqNo));
      // Khôi phục Ghi chú + Ngày đề nghị đã lưu (trước đây không khôi phục nên lưu lại là xoá ghi chú, đổi ngày thành hôm nay)
      const savedNote = batchesOfCustomer.find(b => b.note)?.note || '';
      const savedDateRow = batchesOfCustomer.find(b => b.order_date || b.customer_paid_date);
      const savedDate = savedDateRow ? String(savedDateRow.order_date || savedDateRow.customer_paid_date).slice(0, 10) : '';
      // Tên/SĐT Sale ghi trên giấy (chỉ Hợp đồng ngoại thương có cột lưu) — đề nghị cũ chưa lưu thì giữ mặc định là người đăng nhập
      const savedSale = batchesOfCustomer.find(b => b.sale_name != null || b.sale_phone != null);
      if (savedSale) { setSaleName(savedSale.sale_name || ''); setSalePhone(savedSale.sale_phone || ''); }
      if (savedNote) setNote(savedNote);
      if (savedDate) setRequestDate(savedDate);
      loadedRef.current = { note: savedNote, date: savedDate, requestId: batchesOfCustomer.find(b => b.request_id)?.request_id || null };
      // Khôi phục lại đúng Mã nhánh đã dùng cho đề nghị này (nếu có), để không bị lẫn về khách hàng gốc
      const existingBranchId = batchesOfCustomer.find(b => b.branch_tax_code)?.branch_tax_code;
      if (existingBranchId) {
        const idx = (customer?.branches || []).findIndex(b => b.id === existingBranchId);
        if (idx !== -1) setBranchIndex(idx);
      }
    }
    // chỉ chạy 1 lần khi mở kèm sẵn dữ liệu, không tự chạy lại khi người dùng đang gõ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Thành tiền = Tỷ giá × Số tệ (tự tính, không nhập tay)
  const fxThanhTien = (r) => num(r.tyGia) * num(r.soTe);
  const totalTienChuyen = fxRows.reduce((s, r) => s + fxThanhTien(r), 0);
  const totalSoTe = fxRows.reduce((s, r) => s + num(r.soTe), 0);

  // CTS phải thu (tiền hàng): Thanh Toán Hộ giờ tự tính = Tổng tiền chuyển ngoại tệ (Tỷ giá × Số tệ cộng dồn);
  // Hợp Đồng Ngoại Thương vẫn giữ nguyên là ô nhập tay như cũ.
  // CTS phải thu: Thanh Toán Hộ tự tính = Tổng tiền chuyển ngoại tệ (VNĐ quy đổi);
  // Hợp Đồng Ngoại Thương tự tính = Tổng tiền tệ thanh toán cho khách (Số tệ cộng dồn, không quy đổi VNĐ).
  const ctsPhaiThuFor = (r) => isFx ? totalSoTe : totalTienChuyen;
  const totalPhaiThu = isFx ? totalSoTe : totalTienChuyen;
  const totalThuKhach = voucherRows.reduce((s, r) => s + num(r.daThuKhach), 0);
  const chenhLech = totalThuKhach - totalPhaiThu; // III = II - I (áp dụng cho cả 2 luồng)
  const iMinusII = totalPhaiThu - totalThuKhach;
  const phaiThuKhach = iMinusII > 0 ? iMinusII : 0;
  const phaiTraKhach = iMinusII < 0 ? iMinusII : 0;

  const soTienBangChu = isFx
    ? numberToWords(Math.abs(chenhLech || totalSoTe), 'tệ')
    : numberToWords(Math.abs(totalTienChuyen || Math.abs(phaiTraKhach) || phaiThuKhach));

  // id lô đã có sẵn nhưng dòng chứng từ / dòng ngoại tệ của nó bị bấm ✕ — khi Lưu sẽ xoá phần đó (xoá hẳn lô nếu cả 2 phần đều bỏ)
  const [removedV, setRemovedV] = useState([]);
  const [removedF, setRemovedF] = useState([]);

  const setVoucherField = (idx, key, val) => setVoucherRows(rows => rows.map((r, i) => i === idx ? { ...r, [key]: val } : r));
  const addVoucherRow = () => setVoucherRows(rows => [...rows, blankVoucherRow()]);
  const removeVoucherRow = (idx) => {
    const target = voucherRows[idx];
    if (target?.id) setRemovedV(ids => [...ids, target.id]);
    setVoucherRows(rows => rows.filter((_, i) => i !== idx));
  };

  const setFxField = (idx, key, val) => setFxRows(rows => rows.map((r, i) => i === idx ? { ...r, [key]: val } : r));
  const addFxRow = () => setFxRows(rows => [...rows, blankFxRow()]);
  const removeFxRow = (idx) => {
    const target = fxRows[idx];
    if (target?.id) setRemovedF(ids => [...ids, target.id]);
    setFxRows(rows => rows.filter((_, i) => i !== idx));
  };

  const pickSeller = (id) => {
    setSellerId(id);
    if (sellers[id]) { setReceiveAccount(sellers[id].bankAccount || ''); setBankName(sellers[id].bankName || ''); }
  };

  const handleSaveToSystem = async () => {
    const ok = await saveToSystemCore();
    if (ok) resetAfterSave();
  };

  // Lưu và In cùng lúc: mở sẵn cửa sổ in ngay khi bấm (phải làm trước khi chờ lưu, nếu không trình duyệt chặn popup),
  // lưu vào hệ thống; CHỈ in khi lưu thành công (lưu lỗi thì đóng cửa sổ, không có giấy in ra), rồi mới reset về trống.
  const handleSaveAndPrint = async () => {
    if (!customerId) return alert('Vui lòng chọn khách hàng trước khi lưu.');
    if (!requestNoInput.trim()) return alert('Vui lòng nhập Số đề nghị TT trước khi lưu.');
    const content = document.getElementById('dntt-print-zone').innerHTML; // chụp lại nội dung trước khi form bị reset
    const w = window.open('', '_blank');
    if (!w) alert('Trình duyệt đang chặn cửa sổ bật lên (popup) nên sẽ chỉ lưu, không in. Cho phép popup cho trang này rồi bấm lại nếu cần in.');
    const ok = await saveToSystemCore();
    if (w) { if (ok) printInto(w, content); else w.close(); }
    if (ok) resetAfterSave();
  };

  const resetAfterSave = () => {
    if (onSelectCustomer) { setCustomerId(''); onSelectCustomer(''); }
    setSellerId('');
    setReceiveAccount('');
    setBankName('');
    setNote('');
    setRemovedV([]);
    setRemovedF([]);
    loadedRef.current = { note: '', date: '', requestId: null };
    setRequestNoInput('');
    setVoucherRows([blankVoucherRow()]);
    setFxRows([blankFxRow()]);
    setRequestDate(todayISO());
  };

  // Có dữ liệu thật ở dòng chứng từ / dòng ngoại tệ không (dòng trống hoàn toàn thì bỏ qua).
  const hasVoucherData = (r) => !!(num(r.ctsPhaiThu) || num(r.daThuKhach) || r.dienGiai.trim() || r.tyGiaRow !== '' || r.tienHangRow !== '');
  const hasFxData = (r) => !!(num(r.tyGia) || num(r.soTe) || r.noiDung.trim());

  // Trả về true nếu lưu thành công (KHÔNG tự reset — để caller quyết định)
  // Mỗi LÔ (bản ghi) chứa tối đa 1 dòng chứng từ + 1 dòng ngoại tệ. Dòng đã có sẵn giữ NGUYÊN lô của nó (theo id),
  // không còn ghép 2 bảng theo số thứ tự nữa — nên xoá/sửa/thêm dòng không làm lệch sang lô khác.
  const saveToSystemCore = async () => {
    if (!customerId) { alert('Vui lòng chọn khách hàng trước khi lưu.'); return false; }
    if (!requestNoInput.trim()) { alert('Vui lòng nhập Số đề nghị TT trước khi lưu.'); return false; }

    const lots = new Map(); // id lô -> { id, v, f }
    const ensureLot = (id) => { if (!lots.has(id)) lots.set(id, { id, v: null, f: null }); return lots.get(id); };
    voucherRows.forEach(r => { if (r.id) ensureLot(r.id).v = hasVoucherData(r) ? r : null; });
    fxRows.forEach(r => { if (r.id) ensureLot(r.id).f = hasFxData(r) ? r : null; });
    removedV.forEach(id => ensureLot(id));
    removedF.forEach(id => ensureLot(id));
    const newV = voucherRows.filter(r => !r.id && hasVoucherData(r));
    const newF = fxRows.filter(r => !r.id && hasFxData(r));
    // Dòng mới ưu tiên lấp vào chỗ trống của lô cũ (phần đã bỏ), còn dư mới tạo lô mới
    for (const l of lots.values()) {
      if (!l.v && newV.length) l.v = newV.shift();
      if (!l.f && newF.length) l.f = newF.shift();
    }
    for (let i = 0; i < Math.max(newV.length, newF.length); i++) {
      lots.set(`new-${i}`, { id: null, v: newV[i] || null, f: newF[i] || null });
    }
    const lotList = [...lots.values()];
    const toDelete = lotList.filter(l => l.id && !l.v && !l.f).map(l => l.id);
    const toSave = lotList.filter(l => l.v || l.f);
    if (toSave.length === 0 && toDelete.length === 0) { alert('Chưa có dòng chứng từ hoặc dòng ngoại tệ nào để lưu.'); return false; }

    if (toDelete.length > 0 && onDelete && !confirm(`Lưu sẽ xoá ${toDelete.length} lô hàng đã bị bỏ khỏi đề nghị này. Thao tác không thể hoàn tác. Tiếp tục?`)) return false;

    setSaving(true);
    const savedRequestNo = requestNoInput.trim();
    // Hợp đồng ngoại thương: mọi lô cùng 1 đề nghị chia sẻ 1 request_id để về sau mở lại ĐỦ cả giấy.
    if (!loadedRef.current.requestId) loadedRef.current.requestId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const noteChanged = note !== loadedRef.current.note;
    const dateChanged = requestDate !== loadedRef.current.date;
    try {
      for (const l of toSave) {
        const { v, f } = l;
        const payload = {
          customer_id: customerId,
          branch_tax_code: selectedBranch?.id || null,
          seller_id: sellerId || null,
          bank_account: receiveAccount || null,
          bank_name: bankName || null,
          payment_request_no: savedRequestNo,
          // Phần chứng từ (để null nếu dòng chứng từ của lô này đã bỏ)
          goods_desc: (v?.dienGiai || (!isFx ? f?.noiDung : '')) || null,
          deposit_vnd: v ? (!isFx ? chenhLech : totalSoTe) : null,
          customer_paid_total: v ? (!isFx ? ctsPhaiThuFor(v) : (v.daThuKhach !== '' ? num(v.daThuKhach) : null)) : null,
          // Phần ngoại tệ (để null nếu dòng ngoại tệ của lô này đã bỏ)
          amount_cny: f ? num(f.soTe) : null,
          cny_transferred: f ? num(f.soTe) : null,
          // Chung cho cả 2 luồng: liên kết các lô cùng 1 đề nghị + thông tin ghi trên giấy
          request_id: loadedRef.current.requestId,
          sale_name: saleName,
          sale_phone: salePhone,
          fx_content: f?.noiDung?.trim() ? f.noiDung : null,
          ...(isFx ? {
            exchange_rate: v && v.tyGiaRow !== '' ? num(v.tyGiaRow) : null,
            voucher_exchange_rate: v && v.tyGiaRow !== '' ? num(v.tyGiaRow) : null,
            voucher_amount_fx: v && v.tienHangRow !== '' ? num(v.tienHangRow) : null,
            fx_exchange_rate: f && f.tyGia !== '' ? num(f.tyGia) : null,
          } : {
            exchange_rate: f ? num(f.tyGia) : null,
          }),
        };
        // "Tổng tiền tệ quy đổi" còn sửa tay được ở bảng theo dõi — chỉ ghi lại khi dòng mới/đổi số/đã bỏ dòng, tránh ghi đè số đã sửa
        if (isFx && (!v || !v.id || String(v.daThuKhach) !== v.orig)) {
          payload.fx_converted_total = v && v.daThuKhach !== '' ? num(v.daThuKhach) : null;
        }
        // Lô đã có: chỉ ghi đè Ngày/Ghi chú khi người dùng thực sự đổi (tránh xoá ghi chú từng dòng nhập ở bảng theo dõi)
        if (!l.id || dateChanged) { payload.customer_paid_date = requestDate; payload.order_date = requestDate; }
        if (!l.id || noteChanged) payload.note = note || null;
        const saved = await onSave(l.id, payload);
        // Lưu xong thì gắn id lô vào các dòng — nếu lỗi ở dòng sau, bấm Lưu lại sẽ cập nhật đúng lô này, không sinh bản ghi trùng
        const lotId = saved?.id ?? l.id;
        if (lotId) {
          if (l.v && !l.v.id) setVoucherRows(rows => rows.map(r => (r === l.v ? { ...r, id: lotId } : r)));
          if (l.f && !l.f.id) setFxRows(rows => rows.map(r => (r === l.f ? { ...r, id: lotId } : r)));
        }
      }
      if (toDelete.length > 0 && onDelete) {
        for (const id of toDelete) { await onDelete(id, { skipConfirm: true }); }
      }
      return true;
    } catch (err) {
      alert('Có lỗi khi lưu: ' + err.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const getFullHtml = (innerHTML) => {
    const styleLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .map((el) => `<link rel="stylesheet" href="${el.href}">`).join('\n');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>${styleLinks}<style>${PRINT_STYLE}</style></head><body>${innerHTML}</body></html>`;
  };

  const printInto = (w, content) => {
    w.document.write(getFullHtml(content));
    w.document.close();
    w.onload = () => { w.focus(); w.print(); w.close(); };
    setTimeout(() => { if (!w.closed) { w.focus(); w.print(); w.close(); } }, 800);
  };

  const customerOptions = buildCustomerOptions(customers);
  const sellerOptions = Object.entries(sellers).map(([id, s]) => ({ value: id, label: s.shortName ? `[${s.shortName}] ${s.companyName}` : s.companyName }));

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3 no-print">
        <div className="flex items-center gap-3">
          {onClose && <button onClick={onClose} className="text-gray-500 hover:text-gray-700">← Quay lại</button>}
          <h1 className="text-xl font-bold text-gray-800">🧾 Giấy Đề Nghị Thanh Toán{docLabel ? ` (${docLabel})` : ''} {customerId && requestNoInput ? `#${requestNoInput}` : ''}{customer ? ` — ${displayCustomerName}` : ''}</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={handleSaveAndPrint} disabled={saving || !customerId}
            className="bg-green-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 font-medium">
            {saving ? '⏳ Đang lưu...' : '💾🖨️ Lưu và In'}
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5 no-print">
        {!!onSelectCustomer && (
          <div className="max-w-sm">
            <SearchableSelect label="Tên xuất hóa đơn" required value={encodeCustomerOptionValue(customerId, branchIndex)}
              onChange={(v) => { const { customerId: id, branchIndex: bi } = parseCustomerOptionValue(v); setCustomerId(id); setBranchIndex(bi); onSelectCustomer?.(id); }}
              placeholder="-- Chọn khách hàng --" options={customerOptions} />
          </div>
        )}

        {customerId && (
          <div className={isFx ? 'grid grid-cols-2 gap-4' : 'grid grid-cols-6 gap-4'}>
            <div className={isFx ? '' : 'col-span-2'}>
              <label className="block text-xs text-gray-500 mb-1">Số đề nghị TT (DDMMYY - Mã khách - STT / Cty bán)</label>
              <input type="text" value={requestNoInput}
                onChange={e => setRequestNoInput(e.target.value)}
                placeholder="Nhập số đề nghị" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Ngày làm đề nghị</label>
              <input type="date" value={requestDate} onChange={e => setRequestDate(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            {!isFx && (
              <div>
                <SearchableSelect label="Cty thu tiền (bên bán)" value={sellerId} onChange={pickSeller}
                  placeholder="-- Chọn --" options={sellerOptions} />
              </div>
            )}
            {!isFx && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Số tài khoản nhận tiền</label>
                <input value={receiveAccount} onChange={e => setReceiveAccount(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            )}
            {!isFx && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Ngân hàng</label>
                <input value={bankName} onChange={e => setBankName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            )}
          </div>
        )}

        {customerId && (
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tên Sale</label>
              <input value={saleName} onChange={e => setSaleName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Số điện thoại Sale</label>
              <input value={salePhone} onChange={e => setSalePhone(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
        )}

        {customerId && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-gray-600 uppercase">Bảng chứng từ — mỗi dòng sẽ lưu thành 1 lô hàng mới</label>
            <button onClick={addVoucherRow} className="text-blue-600 hover:text-blue-800 text-sm">+ Thêm dòng</button>
          </div>
          <div className="grid grid-cols-12 gap-2 mb-1 px-1">
            {isFx ? (
              <>
                <label className="col-span-2 text-xs text-gray-500">Diễn giải</label>
                <label className="col-span-1 text-xs text-gray-500">Tỉ giá $</label>
                <label className="col-span-2 text-xs text-gray-500">Tiền hàng $</label>
                <label className="col-span-2 text-xs text-gray-500">Tổng tiền Việt</label>
                <label className="col-span-2 text-xs text-gray-500 whitespace-normal leading-snug">CTS phải thu (CNY)</label>
                <label className="col-span-2 text-xs text-gray-500">Đã thu khách (CNY)</label>
              </>
            ) : (
              <>
                <label className="col-span-6 text-xs text-gray-500">Diễn giải</label>
                <label className="col-span-3 text-xs text-gray-500">CTS phải thu (tiền hàng)</label>
                <label className="col-span-2 text-xs text-gray-500">Đã thu khách (tổng KH đã chuyển)</label>
              </>
            )}
          </div>
          <div className="space-y-2">
            {voucherRows.map((r, i) => {
              return (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                {isFx ? (
                  <>
                    <input value={r.dienGiai} onChange={e => setVoucherField(i, 'dienGiai', e.target.value)} className="col-span-2 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                    <MoneyInput value={r.tyGiaRow} onChange={v => setVoucherField(i, 'tyGiaRow', v)} allowDecimal className="col-span-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right" />
                    <MoneyInput value={r.tienHangRow} onChange={v => setVoucherField(i, 'tienHangRow', v)} allowDecimal className="col-span-2 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right" />
                    <div className="col-span-2 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right bg-gray-50 text-gray-600" title="Tự tính = Tỉ giá × Tiền hàng $">
                      {fmtNum(num(r.tyGiaRow) * num(r.tienHangRow))}
                    </div>
                    <div className="col-span-2 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right bg-gray-50 text-gray-600" title="Tự tính = Tổng tiền tệ thanh toán cho khách">
                      {fmtNum(ctsPhaiThuFor(r))}
                    </div>
                    <MoneyInput value={r.daThuKhach} onChange={v => setVoucherField(i, 'daThuKhach', v)} allowDecimal className="col-span-2 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right" />
                  </>
                ) : (
                  <>
                    <input value={r.dienGiai} onChange={e => setVoucherField(i, 'dienGiai', e.target.value)} className="col-span-6 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                    <div className="col-span-3 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right bg-gray-50 text-gray-600" title="Tự tính = Tổng tiền chuyển ngoại tệ (Tỷ giá × Số tệ)">
                      {fmtNum(ctsPhaiThuFor(r))}
                    </div>
                    <MoneyInput value={r.daThuKhach} onChange={v => setVoucherField(i, 'daThuKhach', v)} className="col-span-2 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right" />
                  </>
                )}
                <button onClick={() => removeVoucherRow(i)} className="col-span-1 text-red-500 hover:text-red-700 text-sm">✕</button>
              </div>
              );
            })}
          </div>
          <div className="text-xs text-gray-400 mt-2">
            I - Tổng phải thu: <b>{fmtNum(totalPhaiThu)}</b> &nbsp;|&nbsp; II - Tổng thu khách: <b>{fmtNum(totalThuKhach)}</b> &nbsp;|&nbsp; III - Chênh lệch: <b>{fmtNum(chenhLech)}</b>
          </div>
        </div>
        )}

        {customerId && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-gray-600 uppercase">Thanh toán ngoại tệ cho khách (nếu trả qua tài khoản Trung Quốc)</label>
            <button onClick={addFxRow} className="text-blue-600 hover:text-blue-800 text-sm">+ Thêm dòng</button>
          </div>
          <div className="grid grid-cols-12 gap-2 mb-1 px-1">
            <label className="col-span-6 text-xs text-gray-500">Nội dung / tài khoản nhận</label>
            <label className="col-span-2 text-xs text-gray-500">Tỷ giá</label>
            <label className="col-span-2 text-xs text-gray-500">Số tệ</label>
            <label className="col-span-2 text-xs text-gray-500">Thành tiền (tự tính)</label>
          </div>
          <div className="space-y-2">
            {fxRows.map((r, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <input value={r.noiDung} onChange={e => setFxField(i, 'noiDung', e.target.value)} className="col-span-6 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                <MoneyInput value={r.tyGia} onChange={v => setFxField(i, 'tyGia', v)} allowDecimal className="col-span-2 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right" />
                <MoneyInput value={r.soTe} onChange={v => setFxField(i, 'soTe', v)} allowDecimal className="col-span-2 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right" />
                <div className="col-span-1 text-sm text-gray-500 text-right pr-1">{fmtNum(fxThanhTien(r))}</div>
                <button onClick={() => removeFxRow(i)} className="col-span-1 text-red-500 hover:text-red-700 text-sm">✕</button>
              </div>
            ))}
          </div>
        </div>
        )}

        {customerId && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Ghi chú</label>
          <input value={note} onChange={e => setNote(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        )}
      </div>

      {/* Vùng xem trước / dùng để in */}
      {customerId && (
      <div id="dntt-print-zone" className="bg-white border border-gray-200 rounded-xl p-8 mt-6" style={{ fontFamily: "'Times New Roman', serif" }}>
        <div style={{ textAlign: 'center', marginBottom: 2 }}>
          <div className="quoc-hieu" style={{ fontSize: '12.5pt', fontWeight: 'bold' }}>CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
          <div className="tieu-ngu" style={{ fontSize: '13pt', fontWeight: 'bold', display: 'inline-block', borderBottom: '1px solid #000', paddingBottom: 1, marginTop: 1 }}>
            Độc lập - Tự do - Hạnh phúc
          </div>
        </div>

        <h2 className="doc-title" style={{ textAlign: 'center', margin: '8px 0 6px', fontSize: '15pt', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          GIẤY ĐỀ NGHỊ THANH TOÁN
          {docLabel && (
            <div style={{ fontSize: '12.5pt', fontWeight: 'bold', letterSpacing: 0, marginTop: 1 }}>
              ({docLabel.toUpperCase()})
            </div>
          )}
        </h2>

        <table className="no-border"><tbody>
          <tr className="no-border">
            <td className="no-border" colSpan={2}>Số đề nghị: <b>{requestNoInput}</b></td>
          </tr>
          <tr className="no-border">
            <td className="no-border">Ngày đề nghị: <b>{fmtDateVN(requestDate)}</b></td>
            <td className="no-border">Mã khách hàng: <b>{customerId}</b></td>
          </tr>
          <tr className="no-border">
            <td className="no-border" colSpan={2}>Tên xuất hóa đơn: <b>{displayCustomerName}</b></td>
          </tr>
          {!isFx && (
            <tr className="no-border">
              <td className="no-border" colSpan={2}>Công ty bên bán: <b>{sellers[sellerId]?.companyName || '—'}</b></td>
            </tr>
          )}
          {!isFx && (
            <tr className="no-border">
              <td className="no-border" colSpan={2}>Số tài khoản nhận tiền: <b>{receiveAccount}{bankName ? ` (${bankName})` : ''}</b></td>
            </tr>
          )}
          <tr className="no-border">
            <td className="no-border">Tên Sale: <b>{saleName || '—'}</b></td>
            <td className="no-border">Số điện thoại Sale: <b>{salePhone || '—'}</b></td>
          </tr>
        </tbody></table>

        <p style={{ marginTop: 6, marginBottom: 3 }}>Đề nghị thanh toán theo bảng kê sau:</p>
        <table style={{ marginBottom: 8 }}>
          <thead>
            <tr>
              <th>Diễn giải</th>
              {isFx && <th style={{ width: 90 }}>Tỉ giá $</th>}
              {isFx && <th style={{ width: 100 }}>Tiền hàng $</th>}
              {isFx && <th style={{ width: 110 }}>Tổng tiền Việt</th>}
              <th style={{ width: 120 }}>{isFx ? 'CTS Phải thu' : 'CTS Phải thu (tiền hàng)'}</th>
              <th style={{ width: 120 }}>Đã thu khách</th>
              <th style={{ width: 120 }}>Chênh lệch</th>
            </tr>
          </thead>
          <tbody>
            {voucherRows.filter(r => r.dienGiai || r.ctsPhaiThu || r.daThuKhach || r.tyGiaRow || r.tienHangRow).map((r, i) => {
              const ctsPhaiThu = ctsPhaiThuFor(r);
              return (
                <tr key={i}>
                  <td>{r.dienGiai}</td>
                  {isFx && <td style={{ textAlign: 'right' }}>{r.tyGiaRow || ''}</td>}
                  {isFx && <td style={{ textAlign: 'right' }}>{r.tienHangRow ? fmtNum(r.tienHangRow) : ''}</td>}
                  {isFx && <td style={{ textAlign: 'right' }}>{fmtNum(num(r.tyGiaRow) * num(r.tienHangRow))}</td>}
                  <td style={{ textAlign: 'right' }}>{ctsPhaiThu ? fmtNum(ctsPhaiThu) : ''}</td>
                  <td style={{ textAlign: 'right' }}>{r.daThuKhach ? fmtNum(r.daThuKhach) : ''}</td>
                  <td style={{ textAlign: 'right' }}>{(num(r.daThuKhach) || ctsPhaiThu) ? fmtNum(num(r.daThuKhach) - ctsPhaiThu) : ''}</td>
                </tr>
              );
            })}
            {/* Gộp phần tổng cộng vào CHUNG bảng chứng từ để khung viền liền mạch, không bị tách rời 2 bảng.
                Nhãn trải hết các cột bên trái, số tiền nằm ở cột cuối (cột Chênh lệch). */}
            <tr><td colSpan={isFx ? 6 : 3} style={{ fontWeight: 'bold' }}>I - Tổng cộng số tiền phải thu</td><td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmtNum(totalPhaiThu)}</td></tr>
            <tr><td colSpan={isFx ? 6 : 3} style={{ fontWeight: 'bold' }}>II - Tổng số tiền thu khách</td><td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmtNum(totalThuKhach)}</td></tr>
            <tr><td colSpan={isFx ? 6 : 3} style={{ fontWeight: 'bold' }}>III - Chênh lệch</td><td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmtNum(chenhLech)}</td></tr>
            <tr><td colSpan={isFx ? 6 : 3}>1 - Công ty phải thu khách (I &gt; II)</td><td style={{ textAlign: 'right' }}>{fmtNum(phaiThuKhach)}</td></tr>
            <tr><td colSpan={isFx ? 6 : 3}>2 - Công ty còn phải trả khách (I &lt; II)</td><td style={{ textAlign: 'right' }}>{fmtNum(phaiTraKhach)}</td></tr>
          </tbody>
        </table>

        <p style={{ fontWeight: 'bold', marginTop: 6, marginBottom: 3 }}>THANH TOÁN NGOẠI TỆ CHO KHÁCH</p>
        <table style={{ marginBottom: 4 }}>
          <thead><tr>
            <th>Nội dung</th>
            <th style={{ width: 80 }}>Tỷ giá</th>
            <th style={{ width: 100 }}>Số tệ</th>
            <th style={{ width: 130 }}>Thành tiền</th>
          </tr></thead>
          <tbody>
            {fxRows.filter(r => r.noiDung || r.tyGia || r.soTe).map((r, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'pre-line' }}>{r.noiDung}</td>
                <td style={{ textAlign: 'right' }}>{r.tyGia}</td>
                <td style={{ textAlign: 'right' }}>{r.soTe ? fmtNum(r.soTe) : ''}</td>
                <td style={{ textAlign: 'right' }}>{fmtNum(fxThanhTien(r))}</td>
              </tr>
            ))}
            {!isFx && (
              <tr>
                <td colSpan={3} style={{ textAlign: 'right', fontWeight: 'bold' }}>Tổng tiền chuyển</td>
                <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmtNum(totalTienChuyen)}</td>
              </tr>
            )}
          </tbody>
        </table>

        <p style={{ marginTop: 4 }}>Bằng chữ: <i>{soTienBangChu}</i></p>
        <p>Ghi chú: {note}</p>

        <table className="no-border" style={{ marginTop: 10 }}><tbody>
          <tr className="no-border"><td className="no-border" colSpan={4} style={{ textAlign: 'right' }}>Ngày {new Date(requestDate).getDate()} tháng {new Date(requestDate).getMonth() + 1} năm {new Date(requestDate).getFullYear()}</td></tr>
        </tbody></table>
        <table className="no-border" style={{ marginTop: 4 }}>
          <tbody>
            <tr className="no-border">
              <td className="no-border" style={{ textAlign: 'center', width: '26%', padding: '2px 6px' }}>
                <div>Người đề nghị</div>
                <div style={{ fontStyle: 'italic', marginTop: 2 }}>(Ký, họ tên)</div>
              </td>
              <td className="no-border" style={{ textAlign: 'center', width: '26%', padding: '2px 6px' }}>
                <div>Trưởng phòng</div>
                <div style={{ fontStyle: 'italic', marginTop: 2 }}>(Ký, họ tên)</div>
              </td>
              <td className="no-border" style={{ textAlign: 'center', width: '26%', padding: '2px 6px' }}>
                <div>Kế toán trưởng</div>
                <div style={{ fontStyle: 'italic', marginTop: 2 }}>(Ký, họ tên)</div>
              </td>
              <td className="no-border" style={{ textAlign: 'center', width: '22%', padding: '2px 6px' }}>
                <div>Giám Đốc</div>
                <div style={{ fontStyle: 'italic', marginTop: 2 }}>(Ký, đóng dấu)</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
};
