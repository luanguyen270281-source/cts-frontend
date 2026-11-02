// File: src/pages/SellersPage.jsx
import { useState } from 'react';
import { Badge } from '../components/Badge';
import { CustomerForm } from './CustomerForm';
import { genSellerId } from '../helpers';

// Format ngày từ YYYY-MM-DD → DD/MM/YY, nếu không phải ISO date thì hiện nguyên (backward compat)
const fmtSellerDate = (val) => {
  if (!val) return null;
  const d = new Date(val);
  if (!isNaN(d.getTime()) && val.includes('-')) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
  }
  return val; // fallback: hiện nguyên dữ liệu cũ (vd: "07/25")
};

export const SellersPage = ({ sellers, onSave, onDelete }) => {
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);

  const filtered = Object.entries(sellers).filter(([id, s]) =>
    !search || s.companyName?.toLowerCase().includes(search.toLowerCase()) || id.toLowerCase().includes(search.toLowerCase())
  );

  const handleAdd = async (form) => {
    const id = genSellerId(sellers);
    await onSave(id, { sellerId: id, ...form });
    setShowAdd(false);
  };

  const handleEdit = async (form) => {
    await onSave(editId, { ...sellers[editId], ...form });
    setEditId(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">🏢 Công ty Bên Bán</h1>
        <button onClick={() => { setShowAdd(true); setEditId(null); }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium shadow">+ Thêm công ty bên bán</button>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Tìm theo tên hoặc mã công ty..."
        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />

      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
          <h2 className="font-semibold text-gray-700 mb-4">Thêm công ty bên bán mới</h2>
          <CustomerForm withShortName onSave={handleAdd} onCancel={() => setShowAdd(false)} />
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-400">Chưa có công ty bên bán nào. Hãy thêm mới!</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                <th className="text-left px-5 py-3">Mã</th>
                <th className="text-left px-5 py-3">Tên công ty</th>
                <th className="text-left px-5 py-3">Người đại diện</th>
                <th className="text-left px-5 py-3">Mã số thuế</th>
                <th className="text-left px-5 py-3">Tài khoản ngân hàng</th>
                <th className="px-5 py-3"></th>
              </tr></thead>
              <tbody>
                {filtered.map(([id, s]) => editId === id ? (
                  <tr key={id} className="border-t border-gray-100">
                    <td colSpan={6} className="p-5">
                      <div className="text-sm font-medium text-blue-700 mb-3">{id}</div>
                      <CustomerForm withShortName init={s} onSave={handleEdit} onCancel={() => setEditId(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={id} className="border-t border-gray-100 hover:bg-gray-50 align-top">
                    <td className="px-5 py-3 whitespace-nowrap">
                      <span className="font-mono font-bold text-blue-600">{id}</span>
                      {s.shortName && <span className="ml-2"><Badge color="purple">{fmtSellerDate(s.shortName)}</Badge></span>}
                    </td>
                    <td className="px-5 py-3 font-medium text-gray-800">{s.companyName}</td>
                    <td className="px-5 py-3 text-gray-600">
                      {s.representative || '–'}
                      {s.position && <div className="text-xs text-gray-400">{s.position}</div>}
                    </td>
                    <td className="px-5 py-3 font-mono text-gray-700 whitespace-nowrap">{s.taxCode || '–'}</td>
                    <td className="px-5 py-3 text-gray-700">
                      <span className="font-mono">{s.bankAccount || '–'}</span>
                      {s.bankName && <div className="text-xs text-gray-400">{s.bankName}</div>}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-right">
                      <button onClick={() => { setEditId(id); setShowAdd(false); }} className="text-blue-600 hover:text-blue-800 mr-3">Sửa</button>
                      <button onClick={() => onDelete(id)} className="text-red-500 hover:text-red-700">Xóa</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
