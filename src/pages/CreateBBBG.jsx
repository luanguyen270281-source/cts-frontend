// File: src/pages/CreateBBBG.jsx
import { useState, useEffect, useRef } from 'react';
import { SearchableSelect } from '../components/SearchableSelect';
import { SaleSearchDropdown } from '../components/SaleSearchDropdown';
import { Alert } from '../components/Alert';
import { PartyInfoCard } from '../components/PartyInfoCard';
import { ContractIdPreview } from '../components/ContractIdPreview';
import { GoodsTable } from '../components/GoodsTable';
import { InvoiceGoodsPicker } from '../components/InvoiceGoodsPicker';
import { normalizeText } from '../utils/textNormalize';
import { CustomerForm } from './CustomerForm';
import { BBBGPreview } from '../previews/BBBGPreview';
import { buildContractId, resolveSaleCode } from '../helpers';
import { api } from '../lib/api';
import { pdfFirstPageToImage } from '../lib/pdfToImage';
import { buildCustomerOptions, parseCustomerOptionValue, encodeCustomerOptionValue } from '../utils/customerOptions';

export const CreateBBBG = ({ sellers, customers, onSave, setPage, editData, isAdmin = false, profile = null, saleProfiles = [], onCreateCustomer, onUpdateSeller }) => {
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [editingSeller, setEditingSeller] = useState(false);
  const [sourceInvoiceNo, setSourceInvoiceNo] = useState(editData?.invoiceNo || '');
  const [sellerOverride, setSellerOverride] = useState(editData?.sellerSnapshot || null); // sửa riêng cho đơn này, không đổi bên bán gốc
  const isEdit = !!editData;
  const [saving, setSaving] = useState(false);
  const [assignedSaleUuid, setAssignedSaleUuid] = useState(editData?._assignedTo || '');
  const [sellerId, setSellerId] = useState(editData?.sellerId || '');
  const [customerId, setCustomerId] = useState(editData?.customerId || '');
  const [stt, setStt] = useState(editData?.stt || '');
  const [date, setDate] = useState(editData?.date || new Date().toISOString().slice(0, 10));
  const [goods, setGoods] = useState(editData?.goods || []);
  const [vatInvoiceImage, setVatInvoiceImage] = useState(editData?.vatInvoiceImage || null); // { data, mediaType } | null
  const [hdntId, setHdntId] = useState(editData?.relatedContracts?.hdnt || '');
  const [ddhId, setDdhId] = useState(editData?.relatedContracts?.ddh || '');
  const [showPreview, setShowPreview] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  // null = số hợp đồng tự sinh theo thông tin bên dưới; nếu khác null là người dùng đã tự sửa
  const [idOverride, setIdOverride] = useState(editData?.contractId ?? null);
  const fileRef = useRef();
  const aiBusyRef = useRef(false); // chặn gọi AI trùng khi dán ảnh 2 lần liên tiếp trong lúc lần trước chưa xong
  const seller = sellerOverride || sellers[sellerId] || {};
  const [branchIndex, setBranchIndex] = useState(null); // null = dang dung Ma goc, khong phai nhanh nao
  const rawCustomer = customers[customerId] || {};
  const selectedBranch = branchIndex != null ? rawCustomer.branches?.[branchIndex] : null;
  // Neu da chon 1 nhanh cu the, dung dung thong tin (ten, dia chi, MST...) cua nhanh do thay vi luon la thong tin goc.
  const customer = selectedBranch ? { ...rawCustomer, ...selectedBranch } : rawCustomer;
  const saleCode = resolveSaleCode(customer, { profile, saleProfiles });

  // Danh sách nhẹ TOÀN BỘ HĐNT/ĐĐH (không tải hết mọi hợp đồng nữa) — dùng để gắn hợp đồng cha.
  const [allHDNTs, setAllHDNTs] = useState([]);
  const [allDDHs, setAllDDHs] = useState([]);
  useEffect(() => {
    api.searchRelatedContracts('HDNT')
      .then(rows => setAllHDNTs(rows.map(r => ({ contractId: r.contract_id, customerId: r.customer_id, sellerId: r.seller_id, customerLabel: r.customer_label }))))
      .catch(e => console.error('Không tải được danh sách HĐNT liên quan:', e.message));
    api.searchRelatedContracts('DDH')
      .then(rows => setAllDDHs(rows.map(r => ({ id: r.id, contractId: r.contract_id, customerId: r.customer_id, sellerId: r.seller_id, customerLabel: r.customer_label }))))
      .catch(e => console.error('Không tải được danh sách ĐĐH liên quan:', e.message));
  }, []);

  const matchingHDNTs = allHDNTs.filter(c => c.customerId === customerId && c.sellerId === sellerId).sort((a, b) => b.contractId.localeCompare(a.contractId));
  const matchingDDHs = allDDHs.filter(c => c.customerId === customerId && c.sellerId === sellerId).sort((a, b) => b.contractId.localeCompare(a.contractId));

  // Ưu tiên hiện các bản ghi cùng KH+bên bán lên đầu (đánh dấu ⭐)
  const matchingHDNTIds = new Set(matchingHDNTs.map(h => h.contractId));
  const hdntOptions = [
    { value: '', label: '-- Không gắn --' },
    ...[...matchingHDNTs, ...allHDNTs.filter(h => !matchingHDNTIds.has(h.contractId))].map(h => ({
      value: h.contractId,
      label: `${h.contractId}${matchingHDNTIds.has(h.contractId) ? ' ⭐' : ''} — ${h.customerLabel}`,
    })),
  ];

  const matchingDDHIds = new Set(matchingDDHs.map(d => d.contractId));
  const ddhOptions = [
    { value: '', label: '-- Không gắn --' },
    ...[...matchingDDHs, ...allDDHs.filter(d => !matchingDDHIds.has(d.contractId))].map(d => ({
      value: d.contractId,
      label: `${d.contractId}${matchingDDHIds.has(d.contractId) ? ' ⭐' : ''} — ${d.customerLabel}`,
    })),
  ];

  useEffect(() => {
    setHdntId(matchingHDNTs[0]?.contractId || '');
    const d = matchingDDHs[0];
    setDdhId(d?.contractId || '');
    if (!d) { setGoods([]); if (!isEdit) setVatInvoiceImage(null); return; }
    api.getContractFull(d.id)
      .then(res => {
        setGoods(res?.data?.goods?.length ? res.data.goods : []);
        if (!isEdit) setVatInvoiceImage(res?.data?.vatInvoiceImage || null);
      })
      .catch(e => console.error('Không tải được dữ liệu ĐĐH:', e.message));
  }, [customerId, sellerId, allHDNTs, allDDHs]);

  const selectDDH = (id) => {
    setDdhId(id);
    const d = allDDHs.find(x => x.contractId === id);
    if (!d) { setGoods([]); setVatInvoiceImage(null); setSourceInvoiceNo(''); return; }
    api.getContractFull(d.id)
      .then(res => {
        setGoods(res?.data?.goods?.length ? res.data.goods : []);
        setVatInvoiceImage(res?.data?.vatInvoiceImage || null);
        setSourceInvoiceNo(res?.data?.invoiceNo || '');
      })
      .catch(e => alert('Không tải được dữ liệu ĐĐH: ' + e.message));
  };

  const fileRef2 = useRef();
  // Đính kèm/đổi hóa đơn VAT riêng (không qua AI) — dùng khi không có ĐĐH gắn sẵn, hoặc muốn đổi ảnh khác
  const handleAttachOnly = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.type === 'application/pdf') {
        const img = await pdfFirstPageToImage(file);
        setVatInvoiceImage({ data: img.base64, mediaType: img.mediaType });
      } else {
        const base64 = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = ev => res(ev.target.result.split(',')[1]);
          r.onerror = rej;
          r.readAsDataURL(file);
        });
        setVatInvoiceImage({ data: base64, mediaType: file.type });
      }
    } catch (err) {
      alert('Không đọc được file này để đính kèm: ' + err.message);
    }
    e.target.value = '';
  };

  // Xử lý chung cho 1 file ảnh/PDF (dùng cho cả Upload và Dán/Paste)
  const processFile = async (file) => {
    if (!file || aiBusyRef.current) return;
    aiBusyRef.current = true;
    setAiError(''); setAiLoading(true);
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = ev => res(ev.target.result.split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const result = await api.readVAT(base64, file.type);
      setGoods(result.goods || []);
      // Tự đính kèm hóa đơn VAT thực tế vừa upload (ưu tiên hơn hóa đơn lấy từ ĐĐH, vì là bản quyết toán cuối).
      try {
        if (file.type === 'application/pdf') {
          const img = await pdfFirstPageToImage(file);
          setVatInvoiceImage({ data: img.base64, mediaType: img.mediaType });
        } else {
          setVatInvoiceImage({ data: base64, mediaType: file.type });
        }
      } catch (attachErr) {
        console.error('Không đính kèm được hóa đơn:', attachErr);
      }
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
      aiBusyRef.current = false;
    }
  };

  // Chọn nhanh từ hóa đơn đã nhập Excel sẵn — tự điền hàng hóa + Khách hàng + Bên bán (không đổi ảnh đính kèm)
  const applyInvoiceGoods = async (inv) => {
    setAiError('');
    setGoods(inv.goods || []);
    setSourceInvoiceNo(inv.invoice_no || '');

    let matchedCustomerId = null;
    if (inv.customer_code && customers[inv.customer_code]) {
      matchedCustomerId = inv.customer_code;
    } else if (inv.customer_name) {
      const target = normalizeText(inv.customer_name);
      const found = Object.entries(customers).find(([, c]) => normalizeText(c.companyName) === target);
      if (found) matchedCustomerId = found[0];
    }

    if (matchedCustomerId) {
      setCustomerId(matchedCustomerId);
    } else if (inv.customer_name && onCreateCustomer) {
      const newId = inv.customer_code || `AUTO-${inv.invoice_no}`;
      if (customers[newId]) {
        setCustomerId(newId);
      } else {
        try {
          await onCreateCustomer(newId, {
            companyName: inv.customer_name,
            address: '', taxCode: '', phone: '', email: '',
            bankAccount: '', bankName: '', representative: '', position: '',
            assignedSale: !isAdmin && profile
              ? { code: profile.ma_sale || '', name: profile.full_name || '', accountId: profile.id }
              : { code: '', name: '', accountId: '' },
            departmentId: '',
          });
          setCustomerId(newId);
        } catch (err) {
          alert('Không tự tạo được khách hàng mới từ hóa đơn: ' + err.message);
        }
      }
    }

    if (inv.seller_tax_code) {
      const targetTax = inv.seller_tax_code.replace(/\D/g, '');
      const found = Object.entries(sellers).find(([, s]) => (s.taxCode || '').replace(/\D/g, '') === targetTax && targetTax);
      if (found) { setSellerId(found[0]); return; }
    }
    if (inv.seller_name) {
      const target = normalizeText(inv.seller_name);
      const found = Object.entries(sellers).find(([, s]) => normalizeText(s.companyName) === target);
      if (found) setSellerId(found[0]);
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files[0];
    await processFile(file);
    e.target.value = '';
  };

  // Cho phép dán ảnh hóa đơn từ clipboard (Ctrl+V / Cmd+V)
  useEffect(() => {
    const onPaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { processFile(file); e.preventDefault(); break; }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const autoContractId = buildContractId({ type: 'BBBG', date, saleCode, stt, sellerName: seller.companyName, customerName: customer.companyName });
  const contractId = idOverride !== null ? idOverride : autoContractId;
  const getContract = () => (customerId && sellerId) ? {
    contractId, type: 'BBBG', customerId, sellerId, saleCode, stt,
    customerName: customer.companyName, date, status: editData?.status || 'Hoàn thành', goods,
    customerSnapshot: customer, sellerSnapshot: seller,
    vatInvoiceImage, invoiceNo: sourceInvoiceNo || null,
    relatedContracts: { hdnt: hdntId, ddh: ddhId }
  } : null;

  const save = async () => {
    if (saving) return;
    if (!sellerId) return alert('Vui lòng chọn công ty bên bán');
    if (!customerId) return alert('Vui lòng chọn khách hàng');
    if (!stt.trim()) return alert('Vui lòng nhập STT (số thứ tự)');
    if (!contractId.trim()) return alert('Số hợp đồng không được để trống');
    setSaving(true);
    try {
      if (!isEdit || contractId !== editData.contractId) {
        const exists = await api.contractIdExists(contractId);
        if (exists) return alert('Số hợp đồng đã tồn tại:\n' + contractId);
      }
      await onSave(getContract(), isEdit ? editData.contractId : null, assignedSaleUuid || null);
      setPage('bbbg');
    } finally {
      setSaving(false);
    }
  };

  const preview = getContract();

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setPage('bbbg')} className="text-blue-600 hover:text-blue-800 text-sm">← Quay lại</button>
        <h1 className="text-2xl font-bold text-gray-800">{isEdit ? '✏️ Sửa Biên Bản Bàn Giao' : 'Tạo Biên Bản Bàn Giao'}</h1>
        {isEdit && <span className="text-sm text-gray-500 font-mono">{editData.contractId}</span>}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <SearchableSelect
            label="Khách hàng" required
            value={encodeCustomerOptionValue(customerId, branchIndex)} onChange={(v) => { const { customerId: id, branchIndex: bi } = parseCustomerOptionValue(v); setCustomerId(id); setBranchIndex(bi); }}
            placeholder="-- Chọn khách hàng --"
            options={buildCustomerOptions(customers)}
          />
          <SearchableSelect
            label="Công ty bên bán" required
            value={sellerId} onChange={(id) => { setSellerId(id); setSellerOverride(null); }}
            placeholder="-- Chọn bên bán --"
            options={Object.entries(sellers).map(([id, s]) => ({ value: id, label: `${s.shortName ? `[${s.shortName}] ` : ''}${s.companyName}` }))}
          />
        </div>

        {(customerId || sellerId) && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <PartyInfoCard title="Bên Mua (tự điền)" p={customer} extra={customer.assignedSale?.code ? <span className="text-gray-400 font-normal"> • Sale: {customer.assignedSale.code}</span> : null}
                onEdit={customerId ? () => setEditingCustomer(v => !v) : null} />
              {editingCustomer && customerId && (
                <div className="mt-2 bg-white border border-gray-200 rounded-lg p-4">
                  <CustomerForm companyLabel="Tên công ty / HKD" init={customer}
                    onSave={async (form) => { await onCreateCustomer(customerId, form); setEditingCustomer(false); }}
                    onCancel={() => setEditingCustomer(false)} />
                </div>
              )}
            </div>
            <div>
              <PartyInfoCard title="Bên Bán (tự điền)" p={seller} extra={seller.shortName ? <span className="text-gray-400 font-normal"> • Viết tắt: {seller.shortName}</span> : null}
                onEdit={sellerId ? () => setEditingSeller(v => !v) : null} />
              {editingSeller && sellerId && (
                <div className="mt-2 bg-white border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-amber-600 mb-2">⚠️ Chỉnh sửa này chỉ áp dụng riêng cho đơn hàng này, không thay đổi thông tin gốc của bên bán.</p>
                  <CustomerForm companyLabel="Tên công ty" withShortName init={seller}
                    onSave={(form) => { setSellerOverride(form); setEditingSeller(false); }}
                    onCancel={() => setEditingSeller(false)} />
                </div>
              )}
            </div>
          </div>
        )}

        {isAdmin && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-600 mb-1">👤 Sale phụ trách <span className="text-gray-400">(admin gán)</span></label>
            <SaleSearchDropdown saleProfiles={saleProfiles} value={assignedSaleUuid} onChange={setAssignedSaleUuid} placeholder="Giao cho sale..." />
          </div>
        )}

        <div className="grid grid-cols-5 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">STT (3 số) <span className="text-red-500">*</span></label>
            <input value={stt} onChange={e => setStt(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="VD: 001"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Ngày lập</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Số hóa đơn (không bắt buộc)</label>
            <input value={sourceInvoiceNo} onChange={e => setSourceInvoiceNo(e.target.value)} placeholder="VD: 00000123"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <SearchableSelect label="Gắn HĐNT" value={hdntId} onChange={setHdntId} placeholder="-- Không gắn --" options={hdntOptions} />
          <SearchableSelect label="Gắn ĐĐH" value={ddhId} onChange={selectDDH} placeholder="-- Không gắn --" options={ddhOptions} />
        </div>

        {Object.keys(sellers).length === 0 && (
          <Alert type="warn">Chưa có công ty bên bán. <button onClick={() => setPage('settings')} className="underline font-medium">Thêm ngay →</button></Alert>
        )}
        {customerId && sellerId && ddhId && <Alert type="info">🔗 Đã gắn ĐĐH <strong>{ddhId}</strong> — hàng hóa tự động lấy từ ĐĐH này (có thể chỉnh sửa bên dưới).</Alert>}
        {customerId && sellerId && stt && (
          <ContractIdPreview
            id={contractId}
            onChange={setIdOverride}
            isAuto={idOverride === null}
            onReset={() => setIdOverride(null)}
          />
        )}

        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-600 mb-2">Bảng hàng hóa thực tế — tự lấy từ ĐĐH đã gắn, hoặc:</label>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={handleFile} className="hidden" />
            <button onClick={() => fileRef.current.click()} disabled={aiLoading}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm disabled:opacity-60">
              {aiLoading ? '⏳ Đang đọc...' : '📷 Upload VAT thực tế (AI đọc)'}
            </button>
            <span className="text-xs text-gray-400">hoặc <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-gray-600">Ctrl/Cmd + V</kbd> dán ảnh hóa đơn</span>
            <span className="text-xs text-gray-400">hoặc bấm "+ Thêm dòng" để nhập tay bên dưới</span>
          </div>
          {aiError && <Alert type="error">{aiError}</Alert>}
          <div className="mb-3">
            <div className="text-xs text-gray-400 mb-1">hoặc chọn từ hóa đơn đã nhập Excel sẵn</div>
            <InvoiceGoodsPicker onApply={applyInvoiceGoods} />
          </div>
          <GoodsTable goods={goods} onChange={setGoods} />
        </div>

        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-600 mb-2">🧾 Hóa đơn VAT đính kèm (in cùng biên bản này)</label>
          {vatInvoiceImage ? (
            <div className="flex items-center gap-3 border border-gray-200 rounded-lg p-3 bg-gray-50">
              <img src={`data:${vatInvoiceImage.mediaType};base64,${vatInvoiceImage.data}`} alt="Hóa đơn VAT" className="h-16 w-16 object-cover rounded border border-gray-300" />
              <div className="flex-1 text-sm text-gray-600">Đã có hóa đơn đính kèm (tự lấy từ ĐĐH đã gắn, hoặc đính kèm riêng) — sẽ in/xuất file kèm theo biên bản này.</div>
              <button onClick={() => fileRef2.current.click()} className="text-blue-600 hover:text-blue-800 text-sm font-medium">Đổi ảnh khác</button>
              <button onClick={() => setVatInvoiceImage(null)} className="text-red-500 hover:text-red-700 text-sm font-medium">✕ Gỡ</button>
            </div>
          ) : (
            <div className="text-sm text-gray-400 italic">
              Chưa có hóa đơn đính kèm (ĐĐH đã gắn chưa có hóa đơn, hoặc chưa gắn ĐĐH nào). Bạn có thể <button onClick={() => fileRef2.current.click()} className="text-blue-600 hover:underline font-medium">đính kèm ảnh hóa đơn</button> riêng để in cùng.
            </div>
          )}
          <input ref={fileRef2} type="file" accept="image/*,application/pdf" onChange={handleAttachOnly} className="hidden" />
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setShowPreview(p => !p)} className="bg-gray-100 px-4 py-2 rounded-lg hover:bg-gray-200 text-sm">
          {showPreview ? '🙈 Ẩn xem trước' : '👁️ Xem trước biên bản'}
        </button>
        <button onClick={save} disabled={saving} className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 text-sm font-medium shadow disabled:opacity-50">{saving ? '⏳ Đang lưu...' : isEdit ? '✓ Lưu thay đổi' : '✓ Lưu biên bản'}</button>
      </div>

      {showPreview && preview && (
        <div className="bg-white rounded-xl shadow-sm border-2 border-dashed border-gray-300 p-8">
          <BBBGPreview c={preview} seller={seller} customer={customer} />
        </div>
      )}
    </div>
  );
};
