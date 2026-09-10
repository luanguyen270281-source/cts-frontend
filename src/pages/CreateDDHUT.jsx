// File: src/pages/CreateDDHUT.jsx
import { useState, useEffect, useRef } from 'react';
import { SearchableSelect } from '../components/SearchableSelect';
import { SaleSearchDropdown } from '../components/SaleSearchDropdown';
import { Select } from '../components/Select';
import { Alert } from '../components/Alert';
import { PartyInfoCard } from '../components/PartyInfoCard';
import { ContractIdPreview } from '../components/ContractIdPreview';
import { GoodsTableUSD } from '../components/GoodsTableUSD';
import { ServiceFeeTable } from '../previews/ServiceFeeTable';
import { DDHUTPreview } from '../previews/DDHUTPreview';
import { buildContractId, calcUSDTotal, fmtNum } from '../helpers';
import { api } from '../lib/api';
import { buildCustomerOptions, parseCustomerOptionValue, encodeCustomerOptionValue } from '../utils/customerOptions';

export const CreateDDHUT = ({ sellers, customers, onSave, setPage, editData, isAdmin = false, saleProfiles = [] }) => {
  const isEdit = !!editData;
  const [saving, setSaving] = useState(false);
  const [assignedSaleUuid, setAssignedSaleUuid] = useState(editData?._assignedTo || '');
  const [sellerId, setSellerId] = useState(editData?.sellerId || '');
  const [customerId, setCustomerId] = useState(editData?.customerId || '');
  const [stt, setStt] = useState(editData?.stt || '');
  const [date, setDate] = useState(editData?.date || new Date().toISOString().slice(0, 10));
  const [goodsUSD, setGoodsUSD] = useState(editData?.goodsUSD || []);
  const [exchangeRate, setExchangeRate] = useState(editData?.exchangeRate ?? '');
  const [feeAmount, setFeeAmount] = useState(editData?.goods?.[0]?.donGia ?? '');
  const [vatRate, setVatRate] = useState(editData?.goods?.[0]?.vatRate ?? 8);
  const [hdntUtId, setHdntUtId] = useState(editData?.relatedContracts?.hdnt_ut || '');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiMismatch, setAiMismatch] = useState(null); // { aiTotal, printedTotal } nếu lệch
  const [showPreview, setShowPreview] = useState(false);
  // null = số hợp đồng tự sinh theo thông tin bên dưới; nếu khác null là người dùng đã tự sửa
  const [idOverride, setIdOverride] = useState(editData?.contractId ?? null);
  const fileRef = useRef();
  const aiBusyRef = useRef(false); // chặn gọi AI trùng khi dán ảnh 2 lần liên tiếp trong lúc lần trước chưa xong
  const seller = sellers[sellerId] || {};
  const [branchIndex, setBranchIndex] = useState(null); // null = dang dung Ma goc, khong phai nhanh nao
  const rawCustomer = customers[customerId] || {};
  const selectedBranch = branchIndex != null ? rawCustomer.branches?.[branchIndex] : null;
  // Neu da chon 1 nhanh cu the, dung dung thong tin (ten, dia chi, MST...) cua nhanh do thay vi luon la thong tin goc.
  const customer = selectedBranch ? { ...rawCustomer, ...selectedBranch } : rawCustomer;
  const saleCode = customer.assignedSale?.code || '';

  const [allHDNTs, setAllHDNTs] = useState([]);
  useEffect(() => {
    api.searchRelatedContracts('HDNT_UT')
      .then(rows => setAllHDNTs(rows.map(r => ({ contractId: r.contract_id, customerId: r.customer_id, sellerId: r.seller_id }))))
      .catch(e => console.error('Không tải được danh sách HĐNT liên quan:', e.message));
  }, []);
  const matchingHDNTs = allHDNTs
    .filter(c => c.customerId === customerId && c.sellerId === sellerId)
    .sort((a, b) => b.contractId.localeCompare(a.contractId));

  useEffect(() => { setHdntUtId(matchingHDNTs[0]?.contractId || ''); }, [customerId, sellerId, allHDNTs]);

  // Xử lý chung cho 1 file ảnh/PDF (dùng cho cả Upload và Dán/Paste) — đọc hàng hóa giá USD
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
      const result = await api.readGoodsUSD(base64, file.type);
      const newGoodsUSD = result.goods || [];
      setGoodsUSD(newGoodsUSD);
      const printedTotal = result.tongCongInHoaDon;
      if (printedTotal !== null && printedTotal !== undefined) {
        const aiTotal = calcUSDTotal(newGoodsUSD);
        if (Math.abs(aiTotal - Number(printedTotal)) > 0.5) {
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

  const handleFile = async (e) => {
    const file = e.target.files[0];
    await processFile(file);
    e.target.value = '';
  };

  // Cho phép dán ảnh đơn hàng/invoice từ clipboard (Ctrl+V / Cmd+V)
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


  const fee = Number(feeAmount) || 0;
  const goods = fee > 0 ? [{ stt: 1, tenHang: 'Phí dịch vụ ủy thác trọn gói', dvt: 'Trọn gói', soLuong: 1, donGia: fee, thanhTien: fee, vatRate }] : [];

  const autoContractId = buildContractId({ type: 'DDH_UT', date, saleCode, stt, sellerName: seller.companyName, customerName: customer.companyName });
  const contractId = idOverride !== null ? idOverride : autoContractId;
  const getContract = () => (customerId && sellerId) ? {
    contractId, type: 'DDH_UT', customerId, sellerId, saleCode, stt,
    customerName: customer.companyName, date, status: editData?.status || 'Hiệu lực',
    customerSnapshot: customer, sellerSnapshot: seller,
    goodsUSD, exchangeRate, goods,
    relatedContracts: { hdnt_ut: hdntUtId }
  } : null;

  const save = async () => {
    if (saving) return;
    if (!sellerId) return alert('Vui lòng chọn công ty bên bán');
    if (!customerId) return alert('Vui lòng chọn khách hàng');
    if (!stt.trim()) return alert('Vui lòng nhập STT (số thứ tự)');
    if (!contractId.trim()) return alert('Số hợp đồng không được để trống');
    if (fee <= 0) return alert('Vui lòng nhập phí dịch vụ ủy thác trọn gói');
    setSaving(true);
    try {
      if (!isEdit || contractId !== editData.contractId) {
        const exists = await api.contractIdExists(contractId);
        if (exists) return alert('Số hợp đồng đã tồn tại:\n' + contractId);
      }
      await onSave(getContract(), isEdit ? editData.contractId : null, assignedSaleUuid || null);
      setPage('ddh_ut');
    } finally {
      setSaving(false);
    }
  };

  const preview = getContract();

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setPage('ddh_ut')} className="text-blue-600 hover:text-blue-800 text-sm">← Quay lại</button>
        <h1 className="text-2xl font-bold text-gray-800">{isEdit ? '✏️ Sửa Đơn Đặt Dịch Vụ Ủy Thác' : 'Tạo Đơn Đặt Dịch Vụ Ủy Thác'}</h1>
        {isEdit && <span className="text-sm text-gray-500 font-mono">{editData.contractId}</span>}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <SearchableSelect
            label="Khách hàng (Bên Ủy Thác)" required
            value={encodeCustomerOptionValue(customerId, branchIndex)} onChange={(v) => { const { customerId: id, branchIndex: bi } = parseCustomerOptionValue(v); setCustomerId(id); setBranchIndex(bi); }}
            placeholder="-- Chọn khách hàng --"
            options={buildCustomerOptions(customers)}
          />
          <SearchableSelect
            label="Công ty bên bán (Bên Nhận Ủy Thác)" required
            value={sellerId} onChange={setSellerId}
            placeholder="-- Chọn bên bán --"
            options={Object.entries(sellers).map(([id, s]) => ({ value: id, label: `${s.shortName ? `[${s.shortName}] ` : ''}${s.companyName}` }))}
          />
        </div>

        {(customerId || sellerId) && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <PartyInfoCard title="Bên Ủy Thác (tự điền)" p={customer} extra={customer.assignedSale?.code ? <span className="text-gray-400 font-normal"> • Sale: {customer.assignedSale.code}</span> : null} />
            <PartyInfoCard title="Bên Nhận Ủy Thác (tự điền)" p={seller} extra={seller.shortName ? <span className="text-gray-400 font-normal"> • Viết tắt: {seller.shortName}</span> : null} />
          </div>
        )}

        {isAdmin && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-600 mb-1">👤 Sale phụ trách <span className="text-gray-400">(admin gán)</span></label>
            <SaleSearchDropdown saleProfiles={saleProfiles} value={assignedSaleUuid} onChange={setAssignedSaleUuid} placeholder="Giao cho sale..." />
          </div>
        )}

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">STT (3 số) <span className="text-red-500">*</span></label>
            <input value={stt} onChange={e => setStt(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="VD: 001"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Ngày đặt dịch vụ</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <Select label="Gắn HĐNT ủy thác" value={hdntUtId} onChange={setHdntUtId}>
            <option value="">-- Không gắn --</option>
            {matchingHDNTs.map(h => <option key={h.contractId} value={h.contractId}>{h.contractId}</option>)}
          </Select>
        </div>

        {Object.keys(sellers).length === 0 && (
          <Alert type="warn">Chưa có công ty bên bán. <button onClick={() => setPage('settings')} className="underline font-medium">Thêm ngay →</button></Alert>
        )}
        {customerId && sellerId && (
          matchingHDNTs.length > 0
            ? <Alert type="info">🔗 Có {matchingHDNTs.length} HĐNT ủy thác cho cặp này. {hdntUtId ? <>Đang gắn: <strong>{hdntUtId}</strong></> : 'Chưa chọn HĐNT để gắn.'}</Alert>
            : <Alert type="warn">Cặp KH + Cty bán này chưa có HĐNT ủy thác nào. Bạn có thể tạo HĐNT trước, hoặc để trống.</Alert>
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
          <label className="block text-xs font-medium text-gray-600 mb-2">1.1. Giá trị tiền hàng nhập khẩu (USD) — chọn 1 trong các cách (có thể kết hợp):</label>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={handleFile} className="hidden" />
            <button onClick={() => fileRef.current.click()} disabled={aiLoading}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-60">
              {aiLoading ? '⏳ AI đang đọc đơn hàng...' : '📷 Cách 1: Upload đơn hàng/invoice (AI đọc)'}
            </button>
            <span className="text-xs text-gray-400">hoặc Cách 2: <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-gray-600">Ctrl/Cmd + V</kbd> dán ảnh đơn hàng</span>
            <span className="text-xs text-gray-400">hoặc Cách 3: bấm "+ Thêm dòng" để nhập tay bên dưới</span>
          </div>
          {aiError && <Alert type="error">{aiError}</Alert>}
          {aiMismatch && (
            <Alert type="warn">
              ⚠️ Tổng AI tính được ({fmtNum(aiMismatch.aiTotal)} USD) không khớp với tổng in trên invoice gốc ({fmtNum(aiMismatch.printedTotal)} USD) — vui lòng kiểm tra lại các dòng hàng bên dưới trước khi lưu.
            </Alert>
          )}
          <GoodsTableUSD goods={goodsUSD} onChange={setGoodsUSD} exchangeRate={exchangeRate} onExchangeRateChange={setExchangeRate} />
        </div>

        <div className="mb-2">
          <label className="block text-xs font-medium text-gray-600 mb-2">1.2. Phí dịch vụ ủy thác trọn gói (tạm tính, Vnđ) <span className="text-red-500">*</span></label>
          <div className="flex gap-2 mb-3">
            <input type="number" min="0" value={feeAmount} onChange={e => setFeeAmount(e.target.value)} placeholder="VD: 8000000"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-base font-medium focus:outline-none focus:ring-2 focus:ring-blue-300" />
            <select value={vatRate} onChange={e => setVatRate(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white">
              {[0, 5, 8, 10].map(r => <option key={r} value={r}>VAT {r}%</option>)}
            </select>
          </div>
          {fee > 0 ? (
            <ServiceFeeTable goods={goods} feeLabel="Phí dịch vụ ủy thác trọn gói tạm tính (Vnd)" totalLabel="Tổng cộng giá trị sau thuế (Vnd)" />
          ) : (
            <div className="text-sm text-gray-400 italic">Nhập phí dịch vụ để tự động tính thuế GTGT và tổng cộng.</div>
          )}
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setShowPreview(p => !p)} className="bg-gray-100 px-4 py-2 rounded-lg hover:bg-gray-200 text-sm">
          {showPreview ? '🙈 Ẩn xem trước' : '👁️ Xem trước đơn đặt dịch vụ'}
        </button>
        <button onClick={save} disabled={saving} className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 text-sm font-medium shadow disabled:opacity-50">{saving ? '⏳ Đang lưu...' : isEdit ? '✓ Lưu thay đổi' : '✓ Lưu đơn đặt dịch vụ'}</button>
      </div>

      {showPreview && preview && (
        <div className="bg-white rounded-xl shadow-sm border-2 border-dashed border-gray-300 p-8">
          <DDHUTPreview c={preview} seller={seller} customer={customer} />
        </div>
      )}
    </div>
  );
};
