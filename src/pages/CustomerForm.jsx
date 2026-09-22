// File: src/pages/CustomerForm.jsx
import { useState } from 'react';
import { Field } from '../components/Field';
import { Select } from '../components/Select';
import { SaleSearchDropdown } from '../components/SaleSearchDropdown';
import { normalizeText, removeDiacritics } from '../utils/textNormalize';
import { api } from '../lib/api';

// Với khách hàng cũ chưa gắn accountId (dữ liệu nhập trước khi có dropdown), tự đối chiếu
// theo mã/tên sale đã lưu để điền sẵn — người dùng không cần chọn lại thủ công.
const resolveAssignedSale = (assignedSale, saleProfiles) => {
  const blank = { code: '', name: '', accountId: '' };
  if (!assignedSale) return blank;
  if (assignedSale.accountId) return assignedSale; // đã khớp sẵn, giữ nguyên
  const match = saleProfiles.find((p) =>
    (assignedSale.code && p.ma_sale && normalizeText(p.ma_sale) === normalizeText(assignedSale.code)) ||
    (assignedSale.name && p.name && normalizeText(p.name) === normalizeText(assignedSale.name))
  );
  if (match) return { code: match.ma_sale || '', name: match.name || '', accountId: match.uuid };
  return assignedSale; // không tìm thấy khớp, giữ nguyên dữ liệu cũ để không mất thông tin
};

const genBranchId = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `b_${Date.now()}_${Math.random().toString(36).slice(2)}`;

// Ánh xạ nhanh các chức vụ tiếng Việt thường gặp sang tiếng Anh (dùng cho Sales Contract) —
// không cần gọi AI vì đây là danh sách cố định, tra không thấy thì để chị tự gõ.
const POSITION_EN_MAP = {
  'giam doc': 'Director', 'tong giam doc': 'General Director', 'pho giam doc': 'Deputy Director',
  'chu ho kinh doanh': 'Owner', 'chu doanh nghiep': 'Owner', 'chu tich': 'Chairman',
  'truong phong': 'Manager', 'pho phong': 'Deputy Manager', 'ke toan truong': 'Chief Accountant',
  'nguoi dai dien phap luat': 'Legal Representative',
};
const guessPositionEN = (viText) => {
  const key = removeDiacritics(viText || '').toLowerCase().trim().replace(/\s+/g, ' ');
  return POSITION_EN_MAP[key] || removeDiacritics(viText || '');
};

const blankBranch = () => ({
  id: genBranchId(), // để nhận diện đúng nhánh, không dựa vào Mã số thuế (có thể để trống/trùng nhau)
  taxCode: '', companyName: '', companyNameEN: '', address: '', addressEN: '', phone: '', email: '',
  bankAccount: '', bankName: '', representative: '', representativeEN: '', position: '', positionEN: '',
  receiverName: '', receivingAddress: '',
});
// Bản cũ chỉ lưu {taxCode, name} và chưa có "id" — chuyển "name" thành "companyName", tự cấp thêm "id" ổn định
// cho các nhánh cũ chưa có, để không mất dữ liệu đã nhập trước đó.
const migrateBranch = (b) => ({ ...blankBranch(), ...b, id: b.id || genBranchId(), companyName: b.companyName || b.name || '' });

export const CustomerForm = ({ init, onSave, onCancel, companyLabel = 'Tên công ty', withAssignment = false, withShortName = false, departments = {}, saleProfiles = [], autoSaleAssign = null }) => {
  const blank = {
    companyName: '', companyNameEN: '', address: '', addressEN: '', taxCode: '', phone: '', email: '',
    bankAccount: '', bankName: '', representative: '', representativeEN: '', position: '', positionEN: '',
    receiverName: '', receivingAddress: '',
    branches: [], // Mã nhánh — 1 khách hàng gốc có thể có nhiều nhánh, mỗi nhánh có đủ thông tin riêng như khách hàng gốc
    ...(withShortName ? { shortName: '' } : {}),
    ...(withAssignment ? { assignedSale: autoSaleAssign || { code: '', name: '', accountId: '' }, departmentId: '' } : {}),
  };
  const initialForm = init
    ? { ...blank, ...init, branches: (init.branches || []).map(migrateBranch), ...(withAssignment ? { assignedSale: resolveAssignedSale(init.assignedSale, saleProfiles) } : {}) }
    : blank;
  const [form, setForm] = useState(initialForm);
  const [translatingAddress, setTranslatingAddress] = useState(false);
  const [translatingBranchIdx, setTranslatingBranchIdx] = useState(null);
  const [expandedBranch, setExpandedBranch] = useState(null); // chỉ 1 mã nhánh mở rộng xem/sửa tại 1 thời điểm
  const upd = (f) => (v) => setForm(p => ({ ...p, [f]: v }));

  const translateAddress = async () => {
    if (!form.address?.trim()) return alert('Vui lòng nhập Địa chỉ (tiếng Việt) trước.');
    setTranslatingAddress(true);
    try {
      const en = await api.translateAddressToEnglish(form.address);
      if (en) upd('addressEN')(en);
    } catch (e) {
      alert(e.message || 'Có lỗi khi dịch địa chỉ.');
    }
    setTranslatingAddress(false);
  };
  const selectSale = (uuid) => {
    const p = saleProfiles.find(sp => sp.uuid === uuid);
    if (!p) return;
    setForm(prev => ({ ...prev, assignedSale: { code: p.ma_sale || '', name: p.name || '', accountId: p.uuid } }));
  };

  const addBranch = () => setForm(p => {
    const next = { ...p, branches: [...(p.branches || []), blankBranch()] };
    setExpandedBranch(next.branches.length - 1);
    return next;
  });
  const updBranch = (idx, field, v) => setForm(p => ({
    ...p, branches: p.branches.map((b, i) => i === idx ? { ...b, [field]: v } : b),
  }));
  const removeBranch = (idx) => setForm(p => ({ ...p, branches: p.branches.filter((_, i) => i !== idx) }));

  const translateBranchAddress = async (idx) => {
    const b = form.branches[idx];
    if (!b?.address?.trim()) return alert('Vui lòng nhập Địa chỉ (tiếng Việt) của nhánh này trước.');
    setTranslatingBranchIdx(idx);
    try {
      const en = await api.translateAddressToEnglish(b.address);
      if (en) updBranch(idx, 'addressEN', en);
    } catch (e) {
      alert(e.message || 'Có lỗi khi dịch địa chỉ.');
    }
    setTranslatingBranchIdx(null);
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={companyLabel} value={form.companyName} onChange={upd('companyName')} cols={2} required />
        {!withShortName && (
          <Field label="Tên công ty (tiếng Anh) — dùng cho Sales Contract" value={form.companyNameEN} onChange={upd('companyNameEN')} cols={2} />
        )}
        {withShortName && (
          <Field label="Ngày ký / Ngày hiệu lực" value={form.shortName} onChange={upd('shortName')} type="date" />
        )}
        <Field label="Địa chỉ" value={form.address} onChange={upd('address')} cols={2} />
        {!withShortName && (
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Địa chỉ (tiếng Anh) — dùng cho Sales Contract</label>
            <div className="flex gap-2">
              <input value={form.addressEN} onChange={e => upd('addressEN')(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="No. 18, Lane 117, Thai Ha Street, Dong Da Ward, Hanoi City, Vietnam" />
              <button type="button" onClick={translateAddress} disabled={translatingAddress}
                className="shrink-0 text-xs px-3 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                {translatingAddress ? '⏳ Đang dịch...' : '🔄 Dịch tự động'}
              </button>
            </div>
          </div>
        )}
        <Field label="Mã số thuế (gốc)" value={form.taxCode} onChange={upd('taxCode')} />
        <Field label="Số điện thoại" value={form.phone} onChange={upd('phone')} />
        <Field label="Email" value={form.email} onChange={upd('email')} type="email" />
        <Field label="Tên người nhận hàng" value={form.receiverName} onChange={upd('receiverName')} />
        <Field label="Địa chỉ nhận hàng" value={form.receivingAddress} onChange={upd('receivingAddress')} cols={2} />
        <Field label="Số tài khoản" value={form.bankAccount} onChange={upd('bankAccount')} />
        <Field label="Ngân hàng" value={form.bankName} onChange={upd('bankName')} cols={2} />
        <Field label="Người đại diện" value={form.representative} onChange={upd('representative')} />
        <Field label="Chức vụ" value={form.position} onChange={upd('position')} />
        {!withShortName && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Người đại diện (không dấu) — Sales Contract</label>
              <div className="flex gap-2">
                <input value={form.representativeEN} onChange={e => upd('representativeEN')(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="TRINH VAN DUONG" />
                <button type="button" onClick={() => upd('representativeEN')(removeDiacritics(form.representative).toUpperCase())}
                  className="shrink-0 text-xs px-3 rounded-lg border border-gray-300 hover:bg-gray-50">🔄</button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Chức vụ (tiếng Anh) — Sales Contract</label>
              <div className="flex gap-2">
                <input value={form.positionEN} onChange={e => upd('positionEN')(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Director" />
                <button type="button" onClick={() => upd('positionEN')(guessPositionEN(form.position))}
                  className="shrink-0 text-xs px-3 rounded-lg border border-gray-300 hover:bg-gray-50">🔄</button>
              </div>
            </div>
          </>
        )}
        <div className="col-span-2 border-t border-gray-100 pt-3 mt-1">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-gray-500 uppercase">Mã nhánh (các chi nhánh khác của cùng khách hàng này)</label>
            <button type="button" onClick={addBranch} className="text-blue-600 hover:text-blue-800 text-sm">+ Thêm mã nhánh</button>
          </div>
          {(form.branches || []).length === 0 ? (
            <p className="text-xs text-gray-400">Chưa có mã nhánh nào — khách hàng này chỉ dùng 1 mã số thuế gốc ở trên.</p>
          ) : (
            <div className="space-y-2">
              {form.branches.map((b, i) => {
                const isOpen = expandedBranch === i;
                const title = b.companyName || b.taxCode || `Nhánh #${i + 1}`;
                return (
                  <div key={i} className="border border-gray-200 rounded-lg bg-gray-50/50 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-100/60"
                      onClick={() => setExpandedBranch(isOpen ? null : i)}>
                      <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                        <span className="text-gray-400 text-xs">{isOpen ? '▾' : '▸'}</span>
                        {title}{b.taxCode && b.companyName ? ` — MST ${b.taxCode}` : ''}
                      </span>
                      <button type="button" onClick={(e) => { e.stopPropagation(); removeBranch(i); if (isOpen) setExpandedBranch(null); }}
                        className="text-red-500 hover:text-red-700 text-sm">✕ Xoá nhánh</button>
                    </div>
                    {isOpen && (
                      <div className="grid grid-cols-2 gap-3 p-3 border-t border-gray-200">
                        <Field label="Tên công ty / HKD (nhánh)" value={b.companyName} onChange={v => updBranch(i, 'companyName', v)} cols={2} />
                        <Field label="Tên tiếng Anh (nhánh) — dùng cho Sales Contract" value={b.companyNameEN} onChange={v => updBranch(i, 'companyNameEN', v)} cols={2} />
                        <Field label="Địa chỉ" value={b.address} onChange={v => updBranch(i, 'address', v)} cols={2} />
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-gray-600 mb-1">Địa chỉ (tiếng Anh) — dùng cho Sales Contract</label>
                          <div className="flex gap-2">
                            <input value={b.addressEN} onChange={e => updBranch(i, 'addressEN', e.target.value)}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                            <button type="button" onClick={() => translateBranchAddress(i)} disabled={translatingBranchIdx === i}
                              className="shrink-0 text-xs px-3 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                              {translatingBranchIdx === i ? '⏳...' : '🔄 Dịch'}
                            </button>
                          </div>
                        </div>
                        <Field label="Mã số thuế nhánh" value={b.taxCode} onChange={v => updBranch(i, 'taxCode', v)} />
                        <Field label="Số điện thoại" value={b.phone} onChange={v => updBranch(i, 'phone', v)} />
                        <Field label="Email" value={b.email} onChange={v => updBranch(i, 'email', v)} type="email" />
                        <Field label="Tên người nhận hàng" value={b.receiverName} onChange={v => updBranch(i, 'receiverName', v)} />
                        <Field label="Địa chỉ nhận hàng" value={b.receivingAddress} onChange={v => updBranch(i, 'receivingAddress', v)} cols={2} />
                        <Field label="Số tài khoản" value={b.bankAccount} onChange={v => updBranch(i, 'bankAccount', v)} />
                        <Field label="Ngân hàng" value={b.bankName} onChange={v => updBranch(i, 'bankName', v)} cols={2} />
                        <Field label="Người đại diện" value={b.representative} onChange={v => updBranch(i, 'representative', v)} />
                        <Field label="Chức vụ" value={b.position} onChange={v => updBranch(i, 'position', v)} />
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Người đại diện (không dấu)</label>
                          <div className="flex gap-2">
                            <input value={b.representativeEN} onChange={e => updBranch(i, 'representativeEN', e.target.value)}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                            <button type="button" onClick={() => updBranch(i, 'representativeEN', removeDiacritics(b.representative).toUpperCase())}
                              className="shrink-0 text-xs px-3 rounded-lg border border-gray-300 hover:bg-gray-50">🔄</button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Chức vụ (tiếng Anh)</label>
                          <div className="flex gap-2">
                            <input value={b.positionEN} onChange={e => updBranch(i, 'positionEN', e.target.value)}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                            <button type="button" onClick={() => updBranch(i, 'positionEN', guessPositionEN(b.position))}
                              className="shrink-0 text-xs px-3 rounded-lg border border-gray-300 hover:bg-gray-50">🔄</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {withAssignment && (
          <>
            <div className="col-span-2 border-t border-gray-100 pt-2 mt-1 text-xs font-semibold text-gray-500 uppercase">Sale phụ trách &amp; Phòng ban</div>
            {autoSaleAssign ? (
              // Sale tự tạo → tự động gán vào chính họ, không cần chọn
              <div className="col-span-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                👤 Sale phụ trách: <strong>{autoSaleAssign.name || autoSaleAssign.code || 'Tài khoản của bạn'}</strong>
              </div>
            ) : (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Sale phụ trách</label>
                <SaleSearchDropdown saleProfiles={saleProfiles} value={form.assignedSale?.accountId} onChange={selectSale}
                  placeholder="Chọn sale phụ trách..." className="w-full" />
                <p className="text-xs text-gray-400 mt-1">Chọn đúng tên sale trong danh sách để mã sale được gán chính xác — sale đó sẽ thấy được khách hàng này.</p>
              </div>
            )}
            <Select label="Phòng ban" value={form.departmentId || ''} onChange={upd('departmentId')}>
              <option value="">-- Chọn phòng ban --</option>
              {Object.entries(departments).map(([id, d]) => <option key={id} value={id}>{d.name}</option>)}
            </Select>
          </>
        )}
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={() => {
            if (!form.companyName) return alert(`${companyLabel} không được để trống`);
            onSave(form);
          }}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium"
        >Lưu</button>
        <button onClick={onCancel} className="bg-gray-100 px-5 py-2 rounded-lg hover:bg-gray-200 text-sm">Hủy</button>
      </div>
    </div>
  );
};
