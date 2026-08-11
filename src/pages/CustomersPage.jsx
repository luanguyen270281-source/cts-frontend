// File: src/pages/CustomersPage.jsx
import { useState, useRef, useMemo } from 'react';
import { Badge } from '../components/Badge';
import { CustomerForm } from './CustomerForm';
import { Pagination } from '../components/Pagination';
import { downloadCustomerTemplate, parseCustomersFile, exportCustomersToExcel } from '../utils/customerExcel';

const PAGE_SIZE = 50;

export const CustomersPage = ({ customers, departments = {}, onSave, onDelete, onBulkImport, saleProfiles = [], isAdmin = false, profile = null }) => {
  const [search, setSearch] = useState('');
  const [saleFilter, setSaleFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [newCode, setNewCode] = useState('');
  const [importing, setImporting] = useState(false);
  const [pageNum, setPageNum] = useState(1);
  const fileInputRef = useRef(null);

  // Sale tự tạo khách hàng → tự gán vào chính họ, không cần chọn
  const autoSaleAssign = !isAdmin && profile
    ? { code: profile.ma_sale || '', name: profile.full_name || '', accountId: profile.id }
    : null;

  const deptName = (cid) => departments[cid]?.name || '';

  // useMemo: danh sách khách hàng đã lên tới hơn 1000 dòng — tránh lọc lại toàn bộ mỗi lần component
  // render vì lý do khác (VD: đang sửa 1 dòng khác), chỉ lọc lại khi customers/search/filter thực sự đổi.
  const filtered = useMemo(() => Object.entries(customers).filter(([id, c]) => {
    const s = search.toLowerCase();
    const matchSearch = !search || c.companyName?.toLowerCase().includes(s) || id.toLowerCase().includes(s)
      || (c.taxCode || '').toLowerCase().includes(s)
      || (c.branches || []).some(b => (b.taxCode || '').toLowerCase().includes(s) || (b.companyName || b.name || '').toLowerCase().includes(s));
    const sf = saleFilter.trim().toLowerCase();
    const matchSale = !sf || (c.assignedSale?.code || '').toLowerCase().includes(sf) || (c.assignedSale?.name || '').toLowerCase().includes(sf);
    const matchDept = !deptFilter || c.departmentId === deptFilter;
    return matchSearch && matchSale && matchDept;
  }), [customers, search, saleFilter, deptFilter]);

  // Phân trang hiển thị (Xuất Excel vẫn xuất toàn bộ "filtered", không chỉ trang đang xem)
  const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePageNum = Math.min(pageNum, maxPage);
  const paged = filtered.slice((safePageNum - 1) * PAGE_SIZE, safePageNum * PAGE_SIZE);

  const handleAdd = async (form) => {
    const code = newCode.trim();
    if (!code) return alert('Vui lòng nhập mã khách hàng');
    if (customers[code]) return alert('Mã khách hàng đã tồn tại');
    await onSave(code, { customerId: code, ...form });
    setShowAdd(false); setNewCode('');
  };

  const handleEdit = async (form) => {
    await onSave(editId, { ...customers[editId], ...form });
    setEditId(null);
  };

  const handlePickFile = () => fileInputRef.current?.click();

  const handleFileChosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // cho phép chọn lại cùng 1 file lần sau
    if (!file) return;

    setImporting(true);
    try {
      const { rows, errors } = await parseCustomersFile(file, departments, saleProfiles);
      if (rows.length === 0) {
        alert(`Không nhập được khách hàng nào.\n\n${errors.join('\n') || 'File không có dữ liệu hợp lệ.'}`);
        return;
      }
      const proceed = confirm(
        `Tìm thấy ${rows.length} khách hàng trong file.` +
        (errors.length ? `\nCó ${errors.length} dòng bị lỗi/cảnh báo (xem chi tiết sau khi nhập).` : '') +
        `\n\nBấm OK để nhập vào hệ thống. Khách hàng có Mã KH đã tồn tại sẽ được cập nhật đè lên dữ liệu cũ.`
      );
      if (!proceed) return;

      const result = await onBulkImport(rows);
      let msg = `Đã nhập thành công ${result.success} khách hàng.`;
      if (result.failed) msg += `\nLỗi khi lưu ${result.failed} khách hàng:\n${result.errors.join('\n')}`;
      if (errors.length) msg += `\n\nCảnh báo từ file:\n${errors.join('\n')}`;
      alert(msg);
    } catch (err) {
      alert('Không đọc được file: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleExport = () => exportCustomersToExcel(filtered, departments);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-800">👥 Khách hàng</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={downloadCustomerTemplate}
            className="text-blue-600 hover:text-blue-800 text-sm font-medium px-2">📄 Tải file mẫu</button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChosen} className="hidden" />
          <button onClick={handlePickFile} disabled={importing}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 text-sm font-medium shadow-sm disabled:opacity-50">
            {importing ? '⏳ Đang nhập...' : '📥 Nhập Excel'}
          </button>
          <button onClick={handleExport}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 text-sm font-medium shadow-sm">📤 Xuất Excel</button>
          <button onClick={() => { setShowAdd(true); setEditId(null); setNewCode(''); }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium shadow">+ Thêm khách hàng</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Tìm theo tên, mã KH, mã số thuế hoặc mã nhánh..."
          className="flex-1 min-w-48 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        <input value={saleFilter} onChange={e => setSaleFilter(e.target.value)} placeholder="Lọc theo Mã / Tên Sale..."
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-300" />
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
          <option value="">Tất cả phòng ban</option>
          {Object.entries(departments).map(([id, d]) => <option key={id} value={id}>{d.name}</option>)}
        </select>
        {(saleFilter || deptFilter) && (
          <button onClick={() => { setSaleFilter(''); setDeptFilter(''); }} className="text-sm text-gray-500 hover:text-gray-700 px-2">✕ Xóa lọc</button>
        )}
      </div>

      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
          <h2 className="font-semibold text-gray-700 mb-4">Thêm khách hàng mới</h2>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">Mã khách hàng (gốc) <span className="text-red-500 ml-0.5">*</span></label>
            <input value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="VD: KH001, ABC, HKD-Nam..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            <p className="text-xs text-gray-400 mt-1">Tự nhập theo ý muốn, không được trùng mã đã có.</p>
          </div>
          <CustomerForm companyLabel="Tên công ty / HKD" withAssignment departments={departments} saleProfiles={isAdmin ? saleProfiles : []} autoSaleAssign={autoSaleAssign} onSave={handleAdd} onCancel={() => { setShowAdd(false); setNewCode(""); }} />
        </div>
      )}

      {filtered.length > 0 && (
        <div className="text-xs text-gray-400 mb-2">Tìm thấy {filtered.length} khách hàng</div>
      )}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-400">Không có khách hàng nào</div>
        ) : (
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="bg-gray-50 text-gray-500 text-xs uppercase">
              <th className="text-left px-5 py-3 w-14">STT</th>
              <th className="text-left px-5 py-3">Mã KH (gốc)</th>
              <th className="text-left px-5 py-3">Tên công ty / HKD</th>
              <th className="text-left px-5 py-3">Người đại diện</th>
              <th className="text-left px-5 py-3">Mã Sale</th>
              <th className="text-left px-5 py-3">Tên Sale</th>
              <th className="text-left px-5 py-3">Phòng ban</th>
              <th className="px-5 py-3"></th>
            </tr></thead>
            <tbody>
              {paged.map(([id, c], idx) => (
                editId === id ? (
                  <tr key={id}><td colSpan="8" className="p-5 bg-blue-50/30 border-t border-gray-100">
                    <div className="text-sm font-medium text-blue-700 mb-3">{id}</div>
                    <CustomerForm companyLabel="Tên công ty / HKD" withAssignment departments={departments} saleProfiles={isAdmin ? saleProfiles : []} autoSaleAssign={autoSaleAssign} init={c} onSave={handleEdit} onCancel={() => setEditId(null)} />
                  </td></tr>
                ) : (
                  <tr key={id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-5 py-3 text-gray-400">{(safePageNum - 1) * PAGE_SIZE + idx + 1}</td>
                    <td className="px-5 py-3 font-mono font-bold text-blue-600">{id}</td>
                    <td className="px-5 py-3 font-medium text-gray-800 relative group cursor-default">
                      {c.companyName}
                      <div className="hidden group-hover:block absolute z-30 left-0 top-full mt-1 w-80 bg-gray-800 text-white text-xs rounded-lg shadow-xl p-3 space-y-1.5 pointer-events-none">
                        <div><span className="text-gray-400">Mã số thuế (gốc): </span>{c.taxCode || '—'}</div>
                        {(c.branches || []).length > 0 && (
                          <div>
                            <span className="text-gray-400">Mã nhánh: </span>
                            {c.branches.map((b, i) => (
                              <span key={i}>{i > 0 ? ', ' : ''}{id} — {b.companyName || b.name || b.taxCode}</span>
                            ))}
                          </div>
                        )}
                        <div><span className="text-gray-400">Địa chỉ: </span>{c.address || '—'}</div>
                        <div><span className="text-gray-400">Người đại diện: </span>{c.representative || '—'}{c.position ? ` (${c.position})` : ''}</div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-600">{c.representative || '–'}</td>
                    <td className="px-5 py-3 text-gray-600 font-mono">{c.assignedSale?.code || '–'}</td>
                    <td className="px-5 py-3 text-gray-600">{c.assignedSale?.name || '–'}</td>
                    <td className="px-5 py-3">{deptName(c.departmentId) ? <Badge color="blue">{deptName(c.departmentId)}</Badge> : <span className="text-gray-400">–</span>}</td>
                    <td className="px-5 py-3 whitespace-nowrap text-right">
                      <button onClick={() => { setEditId(id); setShowAdd(false); }} className="text-blue-600 hover:text-blue-800 mr-3">Sửa</button>
                      <button onClick={() => onDelete(id)} className="text-red-500 hover:text-red-700">Xóa</button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        )}
        <Pagination page={safePageNum} maxPage={maxPage} onChange={setPageNum} />
      </div>
    </div>
  );
};
