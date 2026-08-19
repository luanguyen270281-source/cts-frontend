// File: src/pages/SalesContractPage.jsx
// Sales Contract — hợp đồng ngoại thương tiếng Anh giữa Seller (nhà máy Trung Quốc, nhập tay mỗi lần vì
// đổi liên tục theo lô hàng) và Buyer (khách hàng của CTS, chọn từ danh sách Khách hàng có sẵn).
// Đây là phân hệ HOÀN TOÀN RIÊNG, độc lập với contracts (HĐNT/ĐĐH/BBBG), cash_flow_batches, fx_contract_batches.
import { useState, useMemo } from 'react';
import { SearchableSelect } from '../components/SearchableSelect';
import { PartyInfoCard } from '../components/PartyInfoCard';
import { Alert } from '../components/Alert';
import { SalesContractPreview } from '../previews/SalesContractPreview';
import { buildCustomerOptions, parseCustomerOptionValue, encodeCustomerOptionValue } from '../utils/customerOptions';
import { buildSalesContractNo, fmtNum, amountToWordsEN, genForeignSellerId } from '../helpers';
import { doPrintZone, doDownloadPDFZone, doDownloadWordZone, safeFilename } from '../utils/docExport';
import { api } from '../lib/api';

const PRINT_STYLE = `
  @page {
    size: A4 portrait;
    /* Chuẩn thể thức: lề trên 2cm, phải 2cm, dưới 2cm, trái 3cm */
    margin: 20mm 20mm 20mm 30mm;
  }
  body { font-family: 'Times New Roman', Times, serif; font-size: 13pt; line-height: 1.5; color: #000; background: #fff; }
  .contract-paper { font-size: 13pt; line-height: 1.5; }
  .contract-paper .text-sm { font-size: 13pt !important; }
  .contract-paper .text-base { font-size: 14pt !important; }
  .contract-paper .text-xs { font-size: 11pt !important; }
  table { border-collapse: collapse; width: 100%; }
  /* Chống cắt NGANG khi sang trang: giữ nguyên cả khối điều khoản, hàng bảng, đoạn văn */
  .avoid-break { break-inside: avoid; page-break-inside: avoid; }
  tr, thead, .contract-paper p { break-inside: avoid; page-break-inside: avoid; }
  h1, h2, h3, .font-bold { break-after: avoid; page-break-after: avoid; }
`;

const blankItem = () => ({
  id: Math.random().toString(36).slice(2, 9),
  descriptionEN: '', vietnameseName: '', hsCode: '', origin: 'CHINA', qty: '', unit: 'PCE', unitPrice: '',
});

const blankForm = () => ({
  contractNo: '',
  date: new Date().toISOString().slice(0, 10),
  seller: { name: '', address: '', rep: '', position: 'Director' },
  customerId: '', branchIndex: null,
  buyer: { name: '', address: '', rep: '', position: 'Director' },
  items: [blankItem()],
  quality: "First class and 100% brand new, conformed to manufacturer's specification.",
  incotermsRef: 'Incoterms 2000',
  shippingMethod: 'By Truck',
  incoterms: 'DAF - Huu Nghi Border Gate or DAF - Tan Thanh Border Gate',
  portLoading: 'Pingxiang, China',
  portDischarge: 'Huu Nghi, Lang Son, Vietnam',
  partialShipment: 'Allowed',
  earlyShipment: 'Allowed',
  latestShipment: 'Within 30 days from the sales contract date.',
  noticeShipment: 'Within 03 working days after loading the cargo, the seller should inform the buyer of particulars of the shipment.',
  defectiveGoodsNote: "Wrong or defective goods will be returned to the seller for replacement or refunds. All charges associated with return of the defective or wrong goods to be delivered the new one to buyer. All charges shall be at seller's account.",
  packingStandard: 'Manufactures standard packing.',
  packing: 'By international standard for export packing to ensure safety of the goods from damages and corrosion during transportation. The seller shall be fully responsible for loss, damage, breakage of the goods and/or rusting/corrosion resulting from defective or inadequate packing.',
  paymentTerm: 'The buyer shall pay 100% of the total contract value by Telegraphic Transfer before shipment',
  telegraphicTransfer: 'T/T',
  bankName: '', bankAddress: '', swiftCode: '', accountNumber: '', beneficiary: '',
  feesNote: "All fees inside Vietnam is at the Buyer's account. All fees outside Vietnam is at the Seller's account.",
  artworkCommitment: 'The Seller will commit to make mass production completely 100% similar to the artwork that is approved by the Buyer.',
  artworkFailureNote: "If the seller fails to make products according to the buyer's sample or artwork, seller must bear all arising costs such as remake or correct products.",
  penalty: 'Penalty for failed products or late delivery will be counted 0.1% value contract per each day delayed.',
});

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
    {children}
  </div>
);
const inCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300';
const TextInput = (p) => <input {...p} className={inCls} />;
const TextArea = (p) => <textarea {...p} className={inCls + ' resize-y'} />;

export const SalesContractPage = ({ salesContracts, customers, foreignSellers = {}, onSaveForeignSeller, onSave, onDelete, isAdmin = false }) => {
  const [view, setView] = useState('list'); // list | form | preview
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null); // id (uuid) đang sửa, null = tạo mới
  const [selectedForeignSellerId, setSelectedForeignSellerId] = useState('');
  const [savingSeller, setSavingSeller] = useState(false);
  const [translatingIds, setTranslatingIds] = useState(new Set());
  const [translateErrorIds, setTranslateErrorIds] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [wordLoading, setWordLoading] = useState(false);

  const rawCustomer = customers[form?.customerId] || {};
  const selectedBranch = form?.branchIndex != null ? rawCustomer.branches?.[form.branchIndex] : null;
  const customer = selectedBranch ? { ...rawCustomer, ...selectedBranch } : rawCustomer;

  const items = form?.items || [];
  const total = items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...salesContracts]
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.updated_at || '').localeCompare(a.updated_at || ''))
      .filter(r => {
        if (!q) return true;
        const d = r.data || {};
        return (d.contractNo || '').toLowerCase().includes(q)
          || (d.buyer?.name || '').toLowerCase().includes(q)
          || (d.seller?.name || '').toLowerCase().includes(q);
      });
  }, [salesContracts, search]);

  const openNew = () => { setForm(blankForm()); setEditingId(null); setSelectedForeignSellerId(''); setView('form'); };

  const openEdit = (row) => {
    setForm({ ...blankForm(), ...row.data, customerId: row.data.customerId || '', branchIndex: row.data.branchIndex ?? null });
    setEditingId(row.id);
    setSelectedForeignSellerId('');
    setView('form');
  };

  const openPreview = (row) => { setForm(row.data); setEditingId(row.id); setView('preview'); };

  const updateField = (path, value) => {
    setForm(prev => {
      const next = { ...prev };
      let obj = next;
      const keys = path.split('.');
      for (let i = 0; i < keys.length - 1; i++) { obj[keys[i]] = { ...obj[keys[i]] }; obj = obj[keys[i]]; }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  };

  const updateItem = (id, key, value) =>
    setForm(prev => ({ ...prev, items: prev.items.map(it => (it.id === id ? { ...it, [key]: value } : it)) }));
  const addItem = () => setForm(prev => ({ ...prev, items: [...prev.items, blankItem()] }));
  const removeItem = (id) =>
    setForm(prev => ({ ...prev, items: prev.items.length > 1 ? prev.items.filter(it => it.id !== id) : prev.items }));

  // Tự động dịch mô tả tiếng Việt → tiếng Anh khi rời khỏi ô (blur) hoặc bấm nút "Dịch" thủ công.
  const translateItem = async (id) => {
    const it = form.items.find(x => x.id === id);
    if (!it || !it.vietnameseName?.trim()) return;
    setTranslatingIds(prev => new Set(prev).add(id));
    setTranslateErrorIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    try {
      const en = await api.translateGoodsDescription(it.vietnameseName);
      if (en) updateItem(id, 'descriptionEN', en);
    } catch (e) {
      setTranslateErrorIds(prev => new Set(prev).add(id));
      console.error('Dịch mô tả lỗi:', e.message);
    }
    setTranslatingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const suggestContractNo = () => {
    updateField('contractNo', buildSalesContractNo({ sellerName: form.seller.name, buyerName: customer.companyName, date: form.date }));
  };

  const foreignSellerOptions = Object.entries(foreignSellers).map(([id, s]) => ({ value: id, label: s.companyName }));

  const applyForeignSeller = (id) => {
    setSelectedForeignSellerId(id);
    const s = foreignSellers[id];
    if (!s) return;
    setForm(prev => ({
      ...prev,
      seller: { name: s.companyName || '', address: s.address || '', rep: s.representative || '', position: s.position || 'Director' },
      bankName: s.bankName || '', bankAddress: s.bankAddress || '', swiftCode: s.swiftCode || '',
      accountNumber: s.accountNumber || '', beneficiary: s.beneficiary || '',
    }));
  };

  const saveCurrentAsForeignSeller = async () => {
    if (!form.seller.name.trim()) return alert('Vui lòng nhập tên Seller trước khi lưu vào danh sách.');
    setSavingSeller(true);
    try {
      const payload = {
        companyName: form.seller.name, address: form.seller.address,
        representative: form.seller.rep, position: form.seller.position,
        bankName: form.bankName, bankAddress: form.bankAddress, swiftCode: form.swiftCode,
        accountNumber: form.accountNumber, beneficiary: form.beneficiary,
      };
      const id = selectedForeignSellerId || genForeignSellerId(foreignSellers);
      await onSaveForeignSeller(id, payload);
      setSelectedForeignSellerId(id);
      alert('Đã lưu vào danh sách Bên bán nước ngoài — lần sau chọn lại là điền sẵn luôn.');
    } catch (e) {
      alert(e.message || 'Có lỗi khi lưu nhà máy.');
    }
    setSavingSeller(false);
  };

  const handleSave = async () => {
    if (!form.seller.name.trim()) return alert('Vui lòng nhập tên Seller (nhà máy Trung Quốc).');
    if (!form.customerId) return alert('Vui lòng chọn Buyer (khách hàng).');
    if (!form.contractNo.trim()) return alert('Vui lòng nhập số hợp đồng (No.)');
    setSaving(true);
    try {
      const data = {
        ...form,
        buyer: {
          name: customer.companyNameEN || customer.companyName || '', address: customer.addressEN || customer.address || '',
          rep: customer.representativeEN || customer.representative || '', position: customer.positionEN || customer.position || 'Director',
        },
      };
      const row = await onSave(editingId, { contract_no: data.contractNo, date: data.date, buyer_customer_id: data.customerId, data });
      setEditingId(row.id);
      setForm(data);
      setView('list');
    } catch (e) {
      alert(e.message || 'Có lỗi khi lưu hợp đồng.');
    }
    setSaving(false);
  };

  const handleDelete = async (row) => {
    if (!confirm(`Xóa Sales Contract ${row.data.contractNo || ''}? Thao tác không thể hoàn tác.`)) return;
    await onDelete(row.id);
  };

  // ───────── LIST ─────────
  if (view === 'list') {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-800">📄 Sales Contract</h1>
          <button onClick={openNew} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium shadow">
            + Tạo Sales Contract
          </button>
        </div>

        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Tìm theo số hợp đồng, tên Seller, tên Buyer..."
          className="w-full border border-gray-300 rounded-lg px-4 py-2.5 mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-gray-400">Chưa có Sales Contract nào. Hãy tạo mới!</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs text-left">
                  <th className="px-4 py-2">Số hợp đồng</th>
                  <th className="px-4 py-2">Ngày</th>
                  <th className="px-4 py-2">Seller</th>
                  <th className="px-4 py-2">Buyer</th>
                  <th className="px-4 py-2 text-right">Tổng tiền (USD)</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => {
                  const d = row.data || {};
                  const t = (d.items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
                  return (
                    <tr key={row.id} className="border-t border-gray-100 hover:bg-blue-50/30 cursor-pointer" onClick={() => openPreview(row)}>
                      <td className="px-4 py-2.5 font-mono font-semibold text-blue-700">{d.contractNo}</td>
                      <td className="px-4 py-2.5 text-gray-600">{d.date}</td>
                      <td className="px-4 py-2.5 text-gray-600 truncate max-w-[180px]">{d.seller?.name}</td>
                      <td className="px-4 py-2.5 text-gray-600 truncate max-w-[180px]">{d.buyer?.name}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-emerald-700">{fmtNum(t)}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <button onClick={() => openEdit(row)} className="text-amber-600 hover:underline text-xs mr-3">Sửa</button>
                        <button onClick={() => handleDelete(row)} className="text-red-500 hover:underline text-xs">Xóa</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  // ───────── FORM (tạo / sửa) ─────────
  if (view === 'form' && form) {
    return (
      <div className="max-w-6xl">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setView('list')} className="text-blue-600 hover:text-blue-800 text-sm">← Quay lại</button>
          <h1 className="text-2xl font-bold text-gray-800">{editingId ? '✏️ Sửa Sales Contract' : '📄 Tạo Sales Contract'}</h1>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-700 mb-3">Thông tin hợp đồng</h2>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Ngày (Date)">
                <TextInput type="date" value={form.date} onChange={e => updateField('date', e.target.value)} />
              </Field>
              <div className="col-span-2">
                <Field label="Số hợp đồng (No.)">
                  <div className="flex gap-2">
                    <TextInput value={form.contractNo} onChange={e => updateField('contractNo', e.target.value)} placeholder="GJ/AD-250726" />
                    <button type="button" onClick={suggestContractNo} className="shrink-0 text-xs px-3 rounded-lg border border-gray-300 hover:bg-gray-50">Gợi ý</button>
                  </div>
                </Field>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="font-semibold text-gray-700 mb-3">Seller / Party A (nhà máy Trung Quốc)</h2>
              <div className="space-y-3">
                {foreignSellerOptions.length > 0 && (
                  <Field label="Chọn nhà máy đã lưu (tùy chọn)">
                    <select className={inCls} value={selectedForeignSellerId} onChange={e => applyForeignSeller(e.target.value)}>
                      <option value="">-- Nhập mới / không dùng danh sách --</option>
                      {foreignSellerOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Tên công ty">
                  <TextInput value={form.seller.name} onChange={e => updateField('seller.name', e.target.value)} placeholder="GUANGXI ... TRADE CO., LTD" />
                </Field>
                <Field label="Địa chỉ">
                  <TextArea rows={2} value={form.seller.address} onChange={e => updateField('seller.address', e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Người đại diện">
                    <TextInput value={form.seller.rep} onChange={e => updateField('seller.rep', e.target.value)} />
                  </Field>
                  <Field label="Chức vụ">
                    <TextInput value={form.seller.position} onChange={e => updateField('seller.position', e.target.value)} />
                  </Field>
                </div>
                <button type="button" disabled={savingSeller} onClick={saveCurrentAsForeignSeller}
                  className="text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-50">
                  {savingSeller ? 'Đang lưu...' : (selectedForeignSellerId ? '💾 Cập nhật nhà máy này trong danh sách' : '💾 Lưu thông tin Seller này vào danh sách (dùng lại lần sau)')}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="font-semibold text-gray-700 mb-3">Buyer / Party B (khách hàng)</h2>
              {Object.keys(customers).length === 0 ? (
                <p className="text-sm text-gray-400 italic">Chưa có khách hàng nào. Vào mục Khách hàng để thêm trước.</p>
              ) : (
                <div className="space-y-3">
                  <SearchableSelect
                    label="Chọn khách hàng (Buyer)" required
                    value={encodeCustomerOptionValue(form.customerId, form.branchIndex)}
                    onChange={(v) => { const { customerId, branchIndex } = parseCustomerOptionValue(v); updateField('customerId', customerId); updateField('branchIndex', branchIndex); }}
                    placeholder="-- Chọn khách hàng --"
                    options={buildCustomerOptions(customers)}
                  />
                  {form.customerId && <PartyInfoCard title="Thông tin Buyer (tự điền)" p={customer} />}
                  {form.customerId && (
                    customer.companyNameEN && customer.addressEN && customer.representativeEN && customer.positionEN ? (
                      <p className="text-xs text-emerald-700">
                        ✓ Trên Sales Contract sẽ dùng: <strong>{customer.companyNameEN}</strong> — {customer.addressEN} — {customer.representativeEN}, {customer.positionEN}
                      </p>
                    ) : (
                      <p className="text-xs text-amber-600">
                        ⚠️ Khách hàng này chưa điền đủ 4 mục tiếng Anh (Tên công ty / Địa chỉ / Người đại diện / Chức vụ) — hợp đồng sẽ tạm dùng
                        bản tiếng Việt cho mục còn thiếu. Vào mục Khách hàng để bổ sung (có nút tự động điền).
                      </p>
                    )
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-700 mb-3">Hàng hóa - Số lượng - Đơn giá</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1500px] border-collapse">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="pb-2 pl-1 w-8">#</th>
                    <th className="pb-2 px-2 w-80">Description (EN) — hiện trên hợp đồng</th>
                    <th className="pb-2 px-2 w-80">Mô tả tiếng Việt (nội bộ) — gõ xong rời ô sẽ tự dịch</th>
                    <th className="pb-2 px-2 w-28">Mã HS</th>
                    <th className="pb-2 px-2 w-28">Xuất xứ</th>
                    <th className="pb-2 px-2 w-20">SL</th>
                    <th className="pb-2 px-2 w-20">ĐVT</th>
                    <th className="pb-2 px-2 w-36">Đơn giá</th>
                    <th className="pb-2 px-2 w-36 text-right">Thành tiền</th>
                    <th className="pb-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={it.id} className="border-t border-gray-100">
                      <td className="py-2 pl-1 text-xs text-gray-400 align-top">{i + 1}</td>
                      <td className="py-2 px-2 align-top">
                        <TextArea rows={2} value={it.descriptionEN} onChange={e => updateItem(it.id, 'descriptionEN', e.target.value)} placeholder="Women's tank top, model WX307" />
                      </td>
                      <td className="py-2 px-2 align-top">
                        <div className="flex items-start gap-1">
                          <TextArea
                            rows={2}
                            value={it.vietnameseName}
                            onChange={e => updateItem(it.id, 'vietnameseName', e.target.value)}
                            onBlur={() => translateItem(it.id)}
                            placeholder="Áo tank nữ, model WX307..."
                          />
                          <button type="button" title="Dịch lại sang tiếng Anh" onClick={() => translateItem(it.id)}
                            disabled={translatingIds.has(it.id)} className="shrink-0 text-sm disabled:opacity-40 mt-1.5">
                            {translatingIds.has(it.id) ? '⏳' : '🔄'}
                          </button>
                        </div>
                        {translateErrorIds.has(it.id) && <p className="text-[11px] text-red-500 mt-0.5">Dịch lỗi, chị điền tay giúp em ở ô Description (EN) nhé.</p>}
                      </td>
                      <td className="py-2 px-2 align-top"><TextInput value={it.hsCode} onChange={e => updateItem(it.id, 'hsCode', e.target.value)} placeholder="61109000" /></td>
                      <td className="py-2 px-2 align-top"><TextInput value={it.origin} onChange={e => updateItem(it.id, 'origin', e.target.value)} /></td>
                      <td className="py-2 px-2 align-top"><TextInput type="number" value={it.qty} onChange={e => updateItem(it.id, 'qty', e.target.value)} /></td>
                      <td className="py-2 px-2 align-top"><TextInput value={it.unit} onChange={e => updateItem(it.id, 'unit', e.target.value)} /></td>
                      <td className="py-2 px-2 align-top"><TextInput type="number" value={it.unitPrice} onChange={e => updateItem(it.id, 'unitPrice', e.target.value)} /></td>
                      <td className="py-2 px-2 text-right font-mono text-sm align-top pt-3">{fmtNum((Number(it.qty) || 0) * (Number(it.unitPrice) || 0))}</td>
                      <td className="py-2 text-center align-top pt-3">
                        <button onClick={() => removeItem(it.id)} className="text-gray-300 hover:text-red-500">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={addItem} className="mt-3 text-xs font-semibold text-emerald-700">+ Thêm dòng hàng</button>
            <div className="flex justify-end mt-4 pt-3 border-t border-gray-100">
              <div className="text-right">
                <p className="text-xs text-gray-500">Tổng giá trị hợp đồng</p>
                <p className="font-mono text-xl font-bold text-gray-800">{fmtNum(total)}</p>
                <p className="text-xs italic text-gray-500 max-w-md">{amountToWordsEN(total)}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="font-semibold text-gray-700 mb-3">Chất lượng &amp; Đóng gói</h2>
              <div className="space-y-3">
                <Field label="Quality"><TextArea value={form.quality} onChange={e => updateField('quality', e.target.value)} /></Field>
                <Field label="Packing — tiêu chuẩn (hiện cạnh mục 3)"><TextInput value={form.packingStandard} onChange={e => updateField('packingStandard', e.target.value)} /></Field>
                <Field label="Packing — nội dung chi tiết"><TextArea value={form.packing} onChange={e => updateField('packing', e.target.value)} /></Field>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="font-semibold text-gray-700 mb-3">Vận chuyển (Shipping)</h2>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Bộ quy tắc Incoterms (dùng ở mục 1 &amp; 2)"><TextInput value={form.incotermsRef} onChange={e => updateField('incotermsRef', e.target.value)} /></Field>
                <Field label="Phương thức vận chuyển"><TextInput value={form.shippingMethod} onChange={e => updateField('shippingMethod', e.target.value)} /></Field>
                <Field label="Điều kiện giao hàng"><TextInput value={form.incoterms} onChange={e => updateField('incoterms', e.target.value)} /></Field>
                <Field label="Thời gian giao hàng"><TextInput value={form.latestShipment} onChange={e => updateField('latestShipment', e.target.value)} /></Field>
                <Field label="Cảng xuất"><TextInput value={form.portLoading} onChange={e => updateField('portLoading', e.target.value)} /></Field>
                <Field label="Cảng nhập"><TextInput value={form.portDischarge} onChange={e => updateField('portDischarge', e.target.value)} /></Field>
                <Field label="Giao hàng từng phần (Partial shipment)"><TextInput value={form.partialShipment} onChange={e => updateField('partialShipment', e.target.value)} /></Field>
                <Field label="Giao hàng sớm (Early shipment)"><TextInput value={form.earlyShipment} onChange={e => updateField('earlyShipment', e.target.value)} /></Field>
                <div className="col-span-2">
                  <Field label="Thông báo giao hàng"><TextInput value={form.noticeShipment} onChange={e => updateField('noticeShipment', e.target.value)} /></Field>
                </div>
                <div className="col-span-2">
                  <Field label="Điều khoản hàng lỗi / giao sai"><TextArea rows={3} value={form.defectiveGoodsNote} onChange={e => updateField('defectiveGoodsNote', e.target.value)} /></Field>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-700 mb-3">Thanh toán (Payment)</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Điều khoản thanh toán"><TextArea rows={2} value={form.paymentTerm} onChange={e => updateField('paymentTerm', e.target.value)} /></Field>
              <Field label="Ghi chú phí"><TextInput value={form.feesNote} onChange={e => updateField('feesNote', e.target.value)} /></Field>
              <Field label="Telegraphic transfer"><TextInput value={form.telegraphicTransfer} onChange={e => updateField('telegraphicTransfer', e.target.value)} /></Field>
              <Field label="Tên ngân hàng"><TextInput value={form.bankName} onChange={e => updateField('bankName', e.target.value)} placeholder="INDUSTRIAL AND COMMERCIAL BANK OF CHINA" /></Field>
              <Field label="Swift code"><TextInput value={form.swiftCode} onChange={e => updateField('swiftCode', e.target.value)} placeholder="ICBKCNBJGSI" /></Field>
              <Field label="Địa chỉ ngân hàng"><TextInput value={form.bankAddress} onChange={e => updateField('bankAddress', e.target.value)} /></Field>
              <Field label="Số tài khoản"><TextInput value={form.accountNumber} onChange={e => updateField('accountNumber', e.target.value)} /></Field>
              <Field label="Người thụ hưởng (Beneficiary)"><TextInput value={form.beneficiary} onChange={e => updateField('beneficiary', e.target.value)} /></Field>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-700 mb-3">Phạt vi phạm (Penalty)</h2>
            <div className="space-y-3">
              <Field label="Cam kết sản xuất đúng mẫu/artwork"><TextArea rows={2} value={form.artworkCommitment} onChange={e => updateField('artworkCommitment', e.target.value)} /></Field>
              <Field label="Trách nhiệm nếu sản xuất sai mẫu"><TextArea rows={2} value={form.artworkFailureNote} onChange={e => updateField('artworkFailureNote', e.target.value)} /></Field>
              <Field label="Điều khoản phạt"><TextArea value={form.penalty} onChange={e => updateField('penalty', e.target.value)} /></Field>
            </div>
          </div>

          <div className="flex justify-end gap-2 pb-8">
            <button onClick={() => setView('list')} className="px-4 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">Hủy</button>
            <button onClick={handleSave} disabled={saving} className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-60">
              {saving ? 'Đang lưu...' : '💾 Lưu Sales Contract'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ───────── PREVIEW / IN / XUẤT FILE ─────────
  if (view === 'preview' && form) {
    const filenameBase = form.contractNo || 'sales-contract';
    return (
      <div className="max-w-4xl">
        <div className="flex items-center justify-between mb-5 no-print flex-wrap gap-2">
          <button onClick={() => setView('list')} className="text-blue-600 hover:text-blue-800 text-sm">← Quay lại danh sách</button>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => doPrintZone('sc-print-zone', PRINT_STYLE)}
              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700">🖨️ In / PDF</button>
            <button disabled={pdfLoading} onClick={async () => {
              setPdfLoading(true);
              try { await doDownloadPDFZone('sc-print-zone', safeFilename(filenameBase, '.pdf')); }
              catch (e) { alert(e.message || 'Có lỗi khi tạo file PDF.'); }
              setPdfLoading(false);
            }} className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-4 py-2 rounded-lg text-sm hover:bg-emerald-100 disabled:opacity-60">
              {pdfLoading ? '⏳ Đang tạo...' : '📥 Tải PDF'}
            </button>
            <button disabled={wordLoading} onClick={async () => {
              setWordLoading(true);
              try { await doDownloadWordZone('sc-print-zone', safeFilename(filenameBase, '.docx'), PRINT_STYLE); }
              catch (e) { alert(e.message || 'Có lỗi khi tạo file Word.'); }
              setWordLoading(false);
            }} className="bg-blue-50 text-blue-700 border border-blue-200 px-4 py-2 rounded-lg text-sm hover:bg-blue-100 disabled:opacity-60">
              {wordLoading ? '⏳ Đang tạo...' : '📄 Tải Word'}
            </button>
            <button onClick={() => openEdit({ id: editingId, data: form })} className="bg-amber-50 text-amber-600 border border-amber-200 px-4 py-2 rounded-lg text-sm hover:bg-amber-100">✏️ Sửa</button>
          </div>
        </div>
        <Alert type="info">Bản xem trước chỉ hiện đúng thông tin gửi cho khách (không có Mã HS / Mô tả tiếng Việt nội bộ).</Alert>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-10" id="sc-print-zone">
          <SalesContractPreview c={form} />
        </div>
      </div>
    );
  }

  return null;
};
