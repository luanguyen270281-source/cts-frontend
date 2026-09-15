// File: src/pages/CreateBBBGUT.jsx
import { useState, useEffect } from 'react';
import { SearchableSelect } from '../components/SearchableSelect';
import { SaleSearchDropdown } from '../components/SaleSearchDropdown';
import { Select } from '../components/Select';
import { Alert } from '../components/Alert';
import { PartyInfoCard } from '../components/PartyInfoCard';
import { ContractIdPreview } from '../components/ContractIdPreview';
import { ServiceFeeTable } from '../previews/ServiceFeeTable';
import { BBBGUTPreview } from '../previews/BBBGUTPreview';
import { buildContractId } from '../helpers';
import { buildCustomerOptions, parseCustomerOptionValue, encodeCustomerOptionValue } from '../utils/customerOptions';
import { api } from '../lib/api';

export const CreateBBBGUT = ({ sellers, customers, onSave, setPage, editData, isAdmin = false, saleProfiles = [] }) => {
  const isEdit = !!editData;
  const [saving, setSaving] = useState(false);
  const [assignedSaleUuid, setAssignedSaleUuid] = useState(editData?._assignedTo || '');
  const [sellerId, setSellerId] = useState(editData?.sellerId || '');
  const [customerId, setCustomerId] = useState(editData?.customerId || '');
  const [stt, setStt] = useState(editData?.stt || '');
  const [date, setDate] = useState(editData?.date || new Date().toISOString().slice(0, 10));
  const [feeAmount, setFeeAmount] = useState(editData?.goods?.[0]?.donGia ?? '');
  const [vatRate, setVatRate] = useState(editData?.goods?.[0]?.vatRate ?? 8);
  const [hdntUtId, setHdntUtId] = useState(editData?.relatedContracts?.hdnt_ut || '');
  const [ddhUtId, setDdhUtId] = useState(editData?.relatedContracts?.ddh_ut || '');
  const [declarationNo, setDeclarationNo] = useState(editData?.declarationNo || '');
  const [packageInfo, setPackageInfo] = useState(editData?.packageInfo || '');
  const [otherInfo, setOtherInfo] = useState(editData?.otherInfo || '');
  const [showPreview, setShowPreview] = useState(false);
  // null = số hợp đồng tự sinh theo thông tin bên dưới; nếu khác null là người dùng đã tự sửa
  const [idOverride, setIdOverride] = useState(editData?.contractId ?? null);
  const seller = sellers[sellerId] || {};
  const [branchIndex, setBranchIndex] = useState(null); // null = dang dung Ma goc, khong phai nhanh nao
  const rawCustomer = customers[customerId] || {};
  const selectedBranch = branchIndex != null ? rawCustomer.branches?.[branchIndex] : null;
  // Neu da chon 1 nhanh cu the, dung dung thong tin (ten, dia chi, MST...) cua nhanh do thay vi luon la thong tin goc.
  const customer = selectedBranch ? { ...rawCustomer, ...selectedBranch } : rawCustomer;
  const saleCode = customer.assignedSale?.code || '';

  const [allHDNTs, setAllHDNTs] = useState([]);
  const [allDDHs, setAllDDHs] = useState([]);
  useEffect(() => {
    api.searchRelatedContracts('HDNT_UT')
      .then(rows => setAllHDNTs(rows.map(r => ({ contractId: r.contract_id, customerId: r.customer_id, sellerId: r.seller_id }))))
      .catch(e => console.error('Không tải được danh sách HĐNT liên quan:', e.message));
    api.searchRelatedContracts('DDH_UT')
      .then(rows => setAllDDHs(rows.map(r => ({ id: r.id, contractId: r.contract_id, customerId: r.customer_id, sellerId: r.seller_id }))))
      .catch(e => console.error('Không tải được danh sách Đơn Đặt Dịch Vụ liên quan:', e.message));
  }, []);

  const matchingHDNTs = allHDNTs.filter(c => c.customerId === customerId && c.sellerId === sellerId).sort((a, b) => b.contractId.localeCompare(a.contractId));
  const matchingDDHs = allDDHs.filter(c => c.customerId === customerId && c.sellerId === sellerId).sort((a, b) => b.contractId.localeCompare(a.contractId));

  useEffect(() => {
    setHdntUtId(matchingHDNTs[0]?.contractId || '');
    const d = matchingDDHs[0];
    setDdhUtId(d?.contractId || '');
    if (!d) { setFeeAmount(''); return; }
    api.getContractFull(d.id)
      .then(res => setFeeAmount(res?.data?.goods?.[0]?.donGia ?? ''))
      .catch(e => console.error('Không tải được dữ liệu Đơn Đặt Dịch Vụ:', e.message));
  }, [customerId, sellerId, allHDNTs, allDDHs]);

  const selectDDH = (id) => {
    setDdhUtId(id);
    const d = allDDHs.find(x => x.contractId === id);
    if (!d) { setFeeAmount(''); return; }
    api.getContractFull(d.id)
      .then(res => setFeeAmount(res?.data?.goods?.[0]?.donGia ?? ''))
      .catch(e => alert('Không tải được dữ liệu Đơn Đặt Dịch Vụ: ' + e.message));
  };

  const fee = Number(feeAmount) || 0;
  const goods = fee > 0 ? [{ stt: 1, tenHang: 'Phí dịch vụ ủy thác nhập khẩu quyết toán trọn gói', dvt: 'Trọn gói', soLuong: 1, donGia: fee, thanhTien: fee, vatRate }] : [];

  const autoContractId = buildContractId({ type: 'BBBG_UT', date, saleCode, stt, sellerName: seller.companyName, customerName: customer.companyName });
  const contractId = idOverride !== null ? idOverride : autoContractId;
  const getContract = () => (customerId && sellerId) ? {
    ...(isEdit ? { _dbId: editData._dbId } : {}),
    contractId, type: 'BBBG_UT', customerId, sellerId, saleCode, stt,
    customerName: customer.companyName, date, status: editData?.status || 'Hoàn thành', goods,
    customerSnapshot: customer, sellerSnapshot: seller,
    declarationNo, packageInfo, otherInfo,
    relatedContracts: { hdnt_ut: hdntUtId, ddh_ut: ddhUtId }
  } : null;

  const save = async () => {
    if (saving) return;
    if (!sellerId) return alert('Vui lòng chọn công ty bên bán');
    if (!customerId) return alert('Vui lòng chọn khách hàng');
    if (!stt.trim()) return alert('Vui lòng nhập STT (số thứ tự)');
    if (!contractId.trim()) return alert('Số hợp đồng không được để trống');
    if (fee <= 0) return alert('Vui lòng nhập giá trị dịch vụ quyết toán');
    setSaving(true);
    try {
      if (!isEdit || contractId !== editData.contractId) {
        const exists = await api.contractIdExists(contractId);
        if (exists) return alert('Số hợp đồng đã tồn tại:\n' + contractId);
      }
      await onSave(getContract(), isEdit ? editData.contractId : null, assignedSaleUuid || null);
      setPage('bbbg_ut');
    } finally {
      setSaving(false);
    }
  };

  const preview = getContract();

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setPage('bbbg_ut')} className="text-blue-600 hover:text-blue-800 text-sm">← Quay lại</button>
        <h1 className="text-2xl font-bold text-gray-800">{isEdit ? '✏️ Sửa Biên Bản Bàn Giao (Ủy thác)' : 'Tạo Biên Bản Bàn Giao (Ủy thác)'}</h1>
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

        <div className="grid grid-cols-4 gap-4 mb-4">
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
          <Select label="Gắn HĐNT ủy thác" value={hdntUtId} onChange={setHdntUtId}>
            <option value="">-- Không gắn --</option>
            {matchingHDNTs.map(h => <option key={h.contractId} value={h.contractId}>{h.contractId}</option>)}
          </Select>
          <Select label="Gắn Đơn Đặt Dịch Vụ" value={ddhUtId} onChange={selectDDH}>
            <option value="">-- Không gắn --</option>
            {matchingDDHs.map(d => <option key={d.contractId} value={d.contractId}>{d.contractId}</option>)}
          </Select>
        </div>

        {Object.keys(sellers).length === 0 && (
          <Alert type="warn">Chưa có công ty bên bán. <button onClick={() => setPage('settings')} className="underline font-medium">Thêm ngay →</button></Alert>
        )}
        {customerId && sellerId && ddhUtId && <Alert type="info">🔗 Đã gắn Đơn Đặt Dịch Vụ <strong>{ddhUtId}</strong> — phí dịch vụ tự động lấy từ đơn này (có thể chỉnh sửa bên dưới).</Alert>}
        {customerId && sellerId && stt && (
          <ContractIdPreview
            id={contractId}
            onChange={setIdOverride}
            isAuto={idOverride === null}
            onReset={() => setIdOverride(null)}
          />
        )}

        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-600 mb-2">Hàng hóa bàn giao (tùy chọn)</label>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Số tờ khai hải quan</label>
              <input value={declarationNo} onChange={e => setDeclarationNo(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Số kiện/thùng</label>
              <input value={packageInfo} onChange={e => setPackageInfo(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Thông tin khác</label>
              <input value={otherInfo} onChange={e => setOtherInfo(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
          </div>

          <label className="block text-xs font-medium text-gray-600 mb-2">Giá trị dịch vụ ủy thác quyết toán thực tế (Vnđ) <span className="text-red-500">*</span></label>
          <div className="flex gap-2 mb-3">
            <input type="number" min="0" value={feeAmount} onChange={e => setFeeAmount(e.target.value)} placeholder="VD: 8000000"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-base font-medium focus:outline-none focus:ring-2 focus:ring-blue-300" />
            <select value={vatRate} onChange={e => setVatRate(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white">
              {[0, 5, 8, 10].map(r => <option key={r} value={r}>VAT {r}%</option>)}
            </select>
          </div>
          {fee > 0 ? (
            <ServiceFeeTable goods={goods} feeLabel="Phí dịch vụ ủy thác nhập khẩu quyết toán trọn gói" totalLabel="Tổng cộng giá trị sau thuế" />
          ) : (
            <div className="text-sm text-gray-400 italic">Nhập giá trị quyết toán để tự động tính thuế GTGT và tổng cộng.</div>
          )}
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
          <BBBGUTPreview c={preview} seller={seller} customer={customer} />
        </div>
      )}
    </div>
  );
};
