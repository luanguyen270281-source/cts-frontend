// File: src/pages/CreateDDH.jsx
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
import { DDHPreview } from '../previews/DDHPreview';
import { buildContractId, calcTotals, fmtNum, resolveSaleCode } from '../helpers';
import { api } from '../lib/api';
import { pdfFirstPageToImage } from '../lib/pdfToImage';
import { buildCustomerOptions, parseCustomerOptionValue, encodeCustomerOptionValue } from '../utils/customerOptions';

export const CreateDDH = ({ sellers, customers, onSave, setPage, editData, isAdmin = false, profile = null, saleProfiles = [], onCreateCustomer, onUpdateSeller }) => {
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [editingSeller, setEditingSeller] = useState(false);
  const [sellerOverride, setSellerOverride] = useState(editData?.sellerSnapshot || null); // sửa riêng cho đơn này, không đổi bên bán gốc
  const [appliedInvoiceDate, setAppliedInvoiceDate] = useState(null); // ngày của hóa đơn vừa áp dụng — để cảnh báo nếu trùng ngày đặt hàng
  const [sourceInvoiceNo, setSourceInvoiceNo] = useState(editData?.invoiceNo || ''); // số hóa đơn đã dùng để tạo đơn này (nếu có)
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
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiMismatch, setAiMismatch] = useState(null); // { aiTotal, printedTotal } nếu lệch
  const [showPreview, setShowPreview] = useState(false);
  // null = số hợp đồng tự sinh theo thông tin bên dưới; nếu khác null là người dùng đã tự sửa
  const [idOverride, setIdOverride] = useState(editData?.contractId ?? null);
  const fileRef = useRef();
  const aiBusyRef = useRef(false); // chặn gọi AI trùng khi dán ảnh 2 lần liên tiếp trong lúc lần trước chưa xong
  const attachRef = useRef();
  const seller = sellerOverride || sellers[sellerId] || {};
  const [branchIndex, setBranchIndex] = useState(null); // null = dang dung Ma goc, khong phai nhanh nao
  const rawCustomer = customers[customerId] || {};
  const selectedBranch = branchIndex != null ? rawCustomer.branches?.[branchIndex] : null;
  // Neu da chon 1 nhanh cu the, dung dung thong tin (ten, dia chi, MST...) cua nhanh do thay vi luon la thong tin goc.
  const customer = selectedBranch ? { ...rawCustomer, ...selectedBranch } : rawCustomer;
  const saleCode = resolveSaleCode(customer, { profile, saleProfiles });

  const customerLabel = (c) => c.customerSnapshot?.companyName || customers[c.customerId]?.companyName || c.customerName || c.customerId;

  // Danh sách nhẹ TOÀN BỘ HĐNT (không tải hết mọi hợp đồng nữa) — dùng để gắn hợp đồng cha.
  const [allHDNTs, setAllHDNTs] = useState([]);
  useEffect(() => {
    api.searchRelatedContracts('HDNT')
      .then(rows => setAllHDNTs(rows.map(r => ({ contractId: r.contract_id, customerId: r.customer_id, sellerId: r.seller_id, date: r.date, customerLabel: r.customer_label }))))
      .catch(e => console.error('Không tải được danh sách HĐNT liên quan:', e.message));
  }, []);

  const matchingHDNTs = allHDNTs
    .filter(c => c.customerId === customerId && c.sellerId === sellerId)
    .sort((a, b) => b.contractId.localeCompare(a.contractId));

  // Ưu tiên hiện các HĐNT cùng KH+bên bán lên đầu (đánh dấu ⭐), sau đó tới toàn bộ HĐNT còn lại
  const matchingIds = new Set(matchingHDNTs.map(h => h.contractId));
  const hdntOptions = [
    { value: '', label: '-- Không gắn --' },
    ...[...matchingHDNTs, ...allHDNTs.filter(h => !matchingIds.has(h.contractId))].map(h => ({
      value: h.contractId,
      label: `${h.contractId}${matchingIds.has(h.contractId) ? ' ⭐' : ''} — ${h.customerLabel}`,
    })),
  ];

  useEffect(() => { setHdntId(matchingHDNTs[0]?.contractId || ''); }, [customerId, sellerId, allHDNTs]);

  // Xử lý chung cho 1 file ảnh/PDF (dùng cho cả Upload và Dán/Paste)
  const processFile = async (file) => {
    if (!file || aiBusyRef.current) return;
    aiBusyRef.current = true;
    setAiError(''); setAiMismatch(null); setAiLoading(true);
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = ev => res(ev.target.result.split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const result = await api.readVAT(base64, file.type);
      const newGoods = result.goods || [];
      setGoods(newGoods);
      // Tự đính kèm luôn hóa đơn vừa upload — giữ lại để in cùng Biên Bản Bàn Giao sau này. PDF tự chuyển sang ảnh trang đầu.
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
      // Đối chiếu: tổng AI tự cộng từ các dòng hàng so với tổng IN SẴN trên hóa đơn gốc (nếu AI đọc được).
      const printedTotal = result.tongCongInHoaDon;
      if (printedTotal !== null && printedTotal !== undefined) {
        const aiTotal = calcTotals(newGoods).total;
        if (Math.abs(aiTotal - Number(printedTotal)) > 1) {
          setAiMismatch({ aiTotal, printedTotal: Number(printedTotal) });
        }
      }
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
      aiBusyRef.current = false;
    }
  };

  // Chọn nhanh từ hóa đơn đã nhập Excel sẵn — tự điền hàng hóa + Khách hàng + Bên bán (không tự đổi Ngày đặt hàng)
  const applyInvoiceGoods = async (inv) => {
    setAiError(''); setAiMismatch(null);
    setGoods(inv.goods || []);
    setAppliedInvoiceDate(inv.invoice_date || null);
    setSourceInvoiceNo(inv.invoice_no || '');

    // Đối chiếu Khách hàng: ưu tiên đúng Mã KH, không có thì so tên công ty
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
      // Khách hàng trong hóa đơn chưa có trong hệ thống — tự tạo mới và lưu luôn
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

    // Đối chiếu Bên bán: ưu tiên mã số thuế, không có thì so tên công ty
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

  // Đính kèm hóa đơn VAT riêng (không gọi AI) — dùng khi nhập hàng tay hoặc muốn đổi ảnh đính kèm khác
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

  const autoContractId = buildContractId({ type: 'DDH', date, saleCode, stt, sellerName: seller.companyName, customerName: customer.companyName });
  const contractId = idOverride !== null ? idOverride : autoContractId;
  const getContract = () => (customerId && sellerId) ? {
    ...(isEdit ? { _dbId: editData._dbId } : {}),
    contractId, type: 'DDH', customerId, sellerId, saleCode, stt,
    customerName: customer.companyName, date, status: editData?.status || 'Hiệu lực', goods,
    customerSnapshot: customer, sellerSnapshot: seller,
    vatInvoiceImage, invoiceNo: sourceInvoiceNo || null,
    relatedContracts: { hdnt: hdntId }
  } : null;

  const save = async () => {
    if (saving) return;
    if (!sellerId) return alert('Vui lòng chọn công ty bên bán');
    if (!customerId) return alert('Vui lòng chọn khách hàng');
    if (!stt.trim()) return alert('Vui lòng nhập STT (số thứ tự)');
    if (!contractId.trim()) return alert('Số hợp đồng không được để trống');
    if (appliedInvoiceDate && date === appliedInvoiceDate) {
      const proceed = confirm(`⚠️ Ngày đặt hàng (${date}) đang trùng với ngày hóa đơn đã áp dụng.\nNgày ĐĐH không nên trùng ngày hóa đơn — vui lòng sửa lại "Ngày đặt hàng".\n\nBấm OK nếu vẫn muốn lưu, hoặc Hủy để quay lại sửa.`);
      if (!proceed) return;
    }
    setSaving(true);
    try {
      if (!isEdit || contractId !== editData.contractId) {
        const exists = await api.contractIdExists(contractId);
        if (exists) return alert('Số hợp đồng đã tồn tại:\n' + contractId);
      }
      await onSave(getContract(), isEdit ? editData.contractId : null, assignedSaleUuid || null);
      setPage('ddh');
    } finally {
      setSaving(false);
    }
  };

  const preview = getContract();

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setPage('ddh')} className="text-blue-600 hover:text-blue-800 text-sm">← Quay lại</button>
        <h1 className="text-2xl font-bold text-gray-800">{isEdit ? '✏️ Sửa Đơn Đặt Hàng' : 'Tạo Đơn Đặt Hàng'}</h1>
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

        <div className="grid grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">STT (3 số) <span className="text-red-500">*</span></label>
            <input value={stt} onChange={e => setStt(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="VD: 001"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Ngày đặt hàng</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Số hóa đơn (không bắt buộc)</label>
            <input value={sourceInvoiceNo} onChange={e => setSourceInvoiceNo(e.target.value)} placeholder="VD: 00000123"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <SearchableSelect label="Gắn HĐNT" value={hdntId} onChange={setHdntId} placeholder="-- Không gắn --" options={hdntOptions} />
        </div>

        {Object.keys(sellers).length === 0 && (
          <Alert type="warn">Chưa có công ty bên bán. <button onClick={() => setPage('settings')} className="underline font-medium">Thêm ngay →</button></Alert>
        )}
        {customerId && sellerId && (
          matchingHDNTs.length > 0
            ? <Alert type="info">🔗 Có {matchingHDNTs.length} HĐNT cho cặp này. {hdntId ? <>Đang gắn: <strong>{hdntId}</strong></> : 'Chưa chọn HĐNT để gắn.'}</Alert>
            : <Alert type="warn">Cặp KH + Cty bán này chưa có HĐNT nào. Bạn có thể tạo HĐNT trước, hoặc để trống.</Alert>
        )}
        {customerId && sellerId && stt && (
          <ContractIdPreview
            id={contractId}
            onChange={setIdOverride}
            isAuto={idOverride === null}
            onReset={() => setIdOverride(null)}
          />
        )}

        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-600 mb-2">Bảng hàng hóa — chọn 1 trong các cách (có thể kết hợp):</label>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={handleFile} className="hidden" />
            <button onClick={() => fileRef.current.click()} disabled={aiLoading}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-60">
              {aiLoading ? '⏳ AI đang đọc hóa đơn...' : '📷 Cách 1: Upload hóa đơn VAT (AI đọc)'}
            </button>
            <span className="text-xs text-gray-400">hoặc Cách 2: <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-gray-600">Ctrl/Cmd + V</kbd> dán ảnh hóa đơn</span>
            <span className="text-xs text-gray-400">hoặc Cách 3: bấm "+ Thêm dòng" để nhập tay bên dưới</span>
          </div>
          <div className="mb-3">
            <div className="text-xs text-gray-400 mb-1">hoặc Cách 4: chọn từ hóa đơn đã nhập Excel sẵn</div>
            <InvoiceGoodsPicker onApply={applyInvoiceGoods} />
          </div>
          {aiError && <Alert type="error" onClose={() => setAiError('')}>{aiError}</Alert>}
          {aiMismatch && (
            <Alert type="warn" onClose={() => setAiMismatch(null)}>
              ⚠️ Tổng AI tính được ({fmtNum(aiMismatch.aiTotal)} đ) không khớp với tổng in trên hóa đơn gốc ({fmtNum(aiMismatch.printedTotal)} đ) — vui lòng kiểm tra lại các dòng hàng bên dưới trước khi lưu.
            </Alert>
          )}
          <GoodsTable goods={goods} onChange={setGoods} />
        </div>

        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-600 mb-2">🧾 Hóa đơn VAT (nếu có) — đính kèm, sẽ in cùng Biên Bản Bàn Giao sau này (không in cùng đơn đặt hàng)</label>
          {vatInvoiceImage ? (
            <div className="flex items-center gap-3 border border-gray-200 rounded-lg p-3 bg-gray-50">
              <img src={`data:${vatInvoiceImage.mediaType};base64,${vatInvoiceImage.data}`} alt="Hóa đơn VAT" className="h-16 w-16 object-cover rounded border border-gray-300" />
              <div className="flex-1 text-sm text-gray-600">Đã đính kèm — sẽ tự chuyển sang Biên Bản Bàn Giao gắn với ĐĐH này khi tạo, để in cùng BBBG.</div>
              <button onClick={() => attachRef.current.click()} className="text-blue-600 hover:text-blue-800 text-sm font-medium">Đổi ảnh khác</button>
              <button onClick={() => setVatInvoiceImage(null)} className="text-red-500 hover:text-red-700 text-sm font-medium">✕ Gỡ</button>
            </div>
          ) : (
            <div className="text-sm text-gray-400 italic">
              Chưa có hóa đơn đính kèm. {goods.length > 0 ? 'Upload hóa đơn VAT ở mục trên (Cách 1) để tự đính kèm, hoặc' : 'Nếu nhập hàng hóa bằng tay, bạn vẫn có thể'} <button onClick={() => attachRef.current.click()} className="text-blue-600 hover:underline font-medium">đính kèm ảnh hóa đơn</button> riêng để in cùng.
            </div>
          )}
          <input ref={attachRef} type="file" accept="image/*,application/pdf" onChange={handleAttachOnly} className="hidden" />
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setShowPreview(p => !p)} className="bg-gray-100 px-4 py-2 rounded-lg hover:bg-gray-200 text-sm">
          {showPreview ? '🙈 Ẩn xem trước' : '👁️ Xem trước hợp đồng'}
        </button>
        <button onClick={save} disabled={saving} className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 text-sm font-medium shadow disabled:opacity-50">{saving ? '⏳ Đang lưu...' : isEdit ? '✓ Lưu thay đổi' : '✓ Lưu đơn đặt hàng'}</button>
      </div>

      {showPreview && preview && (
        <div className="bg-white rounded-xl shadow-sm border-2 border-dashed border-gray-300 p-8">
          <DDHPreview c={preview} seller={seller} customer={customer} />
        </div>
      )}
    </div>
  );
};
