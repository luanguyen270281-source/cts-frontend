// File: src/pages/CreateHDNT.jsx
import { useState } from 'react';
import { Steps } from '../components/Steps';
import { SearchableSelect } from '../components/SearchableSelect';
import { SaleSearchDropdown } from '../components/SaleSearchDropdown';
import { PartyInfoCard } from '../components/PartyInfoCard';
import { ContractIdPreview } from '../components/ContractIdPreview';
import { Alert } from '../components/Alert';
import { HDNTPreview } from '../previews/HDNTPreview';
import { buildContractId, resolveSaleCode } from '../helpers';
import { buildCustomerOptions, parseCustomerOptionValue, encodeCustomerOptionValue } from '../utils/customerOptions';
import { api } from '../lib/api';
import { CustomerForm } from './CustomerForm';

export const CreateHDNT = ({ sellers, customers, onSave, setPage, editData, isAdmin = false, profile = null, saleProfiles = [] }) => {
  const isEdit = !!editData;
  const [saving, setSaving] = useState(false);
  const [assignedSaleUuid, setAssignedSaleUuid] = useState(editData?._assignedTo || '');
  const [step, setStep] = useState(isEdit ? 2 : 0);
  const [customerId, setCustomerId] = useState(editData?.customerId || '');
  const [sellerId, setSellerId] = useState(editData?.sellerId || '');
  const [stt, setStt] = useState(editData?.stt || '');
  const [date, setDate] = useState(editData?.date || new Date().toISOString().slice(0, 10));
  // null = số hợp đồng tự sinh theo thông tin bên dưới; nếu khác null là người dùng đã tự sửa
  const [idOverride, setIdOverride] = useState(editData?.contractId ?? null);
  const [editingSeller, setEditingSeller] = useState(false);
  const [sellerOverride, setSellerOverride] = useState(editData?.sellerSnapshot || null); // sửa riêng cho hợp đồng này, không đổi bên bán gốc
  const seller = sellerOverride || sellers[sellerId] || {};
  const [branchIndex, setBranchIndex] = useState(null); // null = dang dung Ma goc, khong phai nhanh nao
  const rawCustomer = customers[customerId] || {};
  const selectedBranch = branchIndex != null ? rawCustomer.branches?.[branchIndex] : null;
  // Neu da chon 1 nhanh cu the, dung dung thong tin (ten, dia chi, MST...) cua nhanh do thay vi luon la thong tin goc.
  const customer = selectedBranch ? { ...rawCustomer, ...selectedBranch } : rawCustomer;
  const saleCode = resolveSaleCode(customer, { profile, saleProfiles });

  const autoContractId = buildContractId({ type: 'HDNT', date, saleCode, stt, sellerName: seller.companyName, customerName: customer.companyName });
  const contractId = idOverride !== null ? idOverride : autoContractId;
  const preview = (customerId && sellerId) ? {
    ...(isEdit ? { _dbId: editData._dbId } : {}),
    contractId, type: 'HDNT', customerId, sellerId, saleCode, stt,
    customerName: customer.companyName, date, status: editData?.status || 'Hiệu lực', relatedContracts: editData?.relatedContracts || {},
    customerSnapshot: customer, sellerSnapshot: seller,
  } : null;

  const save = async () => {
    if (saving) return; // chặn bấm Lưu 2 lần liên tiếp trong lúc đang kiểm tra/lưu
    if (!stt.trim()) return alert('Vui lòng nhập STT (số thứ tự)');
    if (!contractId.trim()) return alert('Số hợp đồng không được để trống');
    setSaving(true);
    try {
      // Kiểm tra trùng số hợp đồng TOÀN CÔNG TY (mọi sale) ngay tại server — bỏ qua nếu đang sửa và giữ nguyên số cũ
      if (!isEdit || contractId !== editData.contractId) {
        const exists = await api.contractIdExists(contractId);
        if (exists) return alert('Số hợp đồng đã tồn tại:\n' + contractId);
      }
      await onSave(preview, isEdit ? editData.contractId : null, assignedSaleUuid || null);
      setPage('hdnt');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setPage('hdnt')} className="text-blue-600 hover:text-blue-800 text-sm">← Quay lại</button>
        <h1 className="text-2xl font-bold text-gray-800">{isEdit ? '✏️ Sửa HĐ Nguyên Tắc' : 'Tạo HĐ Nguyên Tắc'}</h1>
        {isEdit && <span className="text-sm text-gray-500 font-mono">{editData.contractId}</span>}
      </div>
      <Steps steps={['Chọn khách hàng', 'Chọn công ty bên bán', 'STT + Ngày → Số HĐ']} current={step} />

      {step === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-700 mb-3">Bước 1: Chọn khách hàng (Bên Mua)</h2>
          {Object.keys(customers).length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 mb-3">Chưa có khách hàng nào.</p>
              <button onClick={() => setPage('customers')} className="text-blue-600 hover:underline">+ Thêm khách hàng ngay</button>
            </div>
          ) : (
            <div className="space-y-3">
              <SearchableSelect
                label="Bên Mua (Khách hàng)" required
                value={encodeCustomerOptionValue(customerId, branchIndex)} onChange={(v) => { const { customerId: id, branchIndex: bi } = parseCustomerOptionValue(v); setCustomerId(id); setBranchIndex(bi); }}
                placeholder="-- Chọn khách hàng --"
                options={buildCustomerOptions(customers)}
              />
              {customerId && <PartyInfoCard title="Thông tin Bên Mua (tự điền)" p={customer} extra={customer.assignedSale?.code ? <span className="text-gray-400 font-normal"> • Sale: {customer.assignedSale.code}</span> : null} />}
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <button onClick={() => { if (!customerId) return alert('Vui lòng chọn khách hàng'); setStep(1); }}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium">Tiếp theo →</button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-700 mb-1">Bước 2: Chọn công ty bên bán (Bên Bán)</h2>
          <div className="text-sm text-gray-500 mb-3">Bên Mua: <strong className="text-gray-700">{customerId} – {customer.companyName}</strong></div>
          {Object.keys(sellers).length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 mb-3">Chưa có công ty bên bán nào.</p>
              <button onClick={() => setPage('settings')} className="text-blue-600 hover:underline">+ Thêm công ty bên bán</button>
            </div>
          ) : (
            <div className="space-y-3">
              <SearchableSelect
                label="Bên Bán (Công ty)" required
                value={sellerId} onChange={(id) => { setSellerId(id); setSellerOverride(null); setEditingSeller(false); }}
                placeholder="-- Chọn công ty bên bán --"
                options={Object.entries(sellers).map(([id, s]) => ({ value: id, label: `${s.shortName ? `[${s.shortName}] ` : ''}${s.companyName}` }))}
              />
              {sellerId && <PartyInfoCard title="Thông tin Bên Bán (tự điền)" p={seller} extra={seller.shortName ? <span className="text-gray-400 font-normal"> • Viết tắt: {seller.shortName}</span> : null}
                onEdit={() => setEditingSeller(v => !v)} />}
              {sellerId && editingSeller && (
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-amber-600 mb-2">⚠️ Chỉnh sửa này chỉ áp dụng riêng cho hợp đồng này, không thay đổi thông tin gốc của bên bán.</p>
                  <CustomerForm companyLabel="Tên công ty" withShortName init={seller}
                    onSave={(form) => { setSellerOverride(form); setEditingSeller(false); }}
                    onCancel={() => setEditingSeller(false)} />
                </div>
              )}
            </div>
          )}

        {isAdmin && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-600 mb-1">👤 Sale phụ trách <span className="text-gray-400">(admin gán)</span></label>
            <SaleSearchDropdown saleProfiles={saleProfiles} value={assignedSaleUuid} onChange={setAssignedSaleUuid} placeholder="Giao cho sale..." />
          </div>
        )}
          <div className="flex gap-2 mt-5">
            <button onClick={() => setStep(0)} className="bg-gray-100 px-4 py-2 rounded-lg hover:bg-gray-200 text-sm">← Quay lại</button>
            <button onClick={() => { if (!sellerId) return alert('Vui lòng chọn công ty bên bán'); setStep(2); }}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium">Tiếp theo →</button>
          </div>
        </div>
      )}

      {step === 2 && preview && (
        <div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
            <h2 className="font-semibold text-gray-700 mb-4">Bước 3: STT &amp; Ngày ký</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">STT (3 số) <span className="text-red-500">*</span></label>
                <input value={stt} onChange={e => setStt(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="VD: 001"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ngày ký</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
            </div>
            {!saleCode && <div className="mt-3"><Alert type="warn">Khách hàng này chưa có Mã Sale — số HĐ sẽ thiếu phần mã sale. Nên cập nhật Mã Sale ở mục Khách hàng.</Alert></div>}
            <ContractIdPreview
              id={contractId}
              onChange={setIdOverride}
              isAuto={idOverride === null}
              onReset={() => setIdOverride(null)}
            />
            <div className="border border-gray-200 rounded-lg p-6 bg-gray-50 max-h-96 overflow-y-auto">
              <HDNTPreview c={preview} seller={seller} customer={customer} />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="bg-gray-100 px-4 py-2 rounded-lg hover:bg-gray-200 text-sm">← Quay lại</button>
            <button onClick={save} disabled={saving} className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 text-sm font-medium shadow disabled:opacity-50">{saving ? '⏳ Đang lưu...' : isEdit ? '✓ Lưu thay đổi' : '✓ Lưu hợp đồng'}</button>
          </div>
        </div>
      )}
    </div>
  );
};
