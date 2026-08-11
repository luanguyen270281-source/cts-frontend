// File: src/pages/AdminUsersPage.jsx
import { useState, useEffect } from 'react';
import { api } from '../lib/api';

export const AdminUsersPage = ({ departments }) => {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [edits, setEdits] = useState({});
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const deptOptions = Object.entries(departments || {});

  const load = async () => {
    setLoading(true); setError('');
    try {
      const data = await api.adminListProfiles();
      data.sort((a, b) => (a.approved === b.approved ? 0 : a.approved ? 1 : -1));
      setProfiles(data);
      const e = {};
      data.forEach(p => {
        e[p.id] = { ma_sale: p.ma_sale || '', role: p.role, approved: !!p.approved, department_id: p.department_id || '' };
      });
      setEdits(e);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const setEdit = (id, field, value) =>
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  const save = async (id) => {
    setSavingId(id); setError('');
    try {
      const { ma_sale, role, approved, department_id } = edits[id];
      const updated = await api.updateProfile(id, { ma_sale: ma_sale || null, role, approved, department_id: department_id || null });
      setProfiles(prev => prev.map(p => p.id === id ? { ...p, ...updated } : p));
    } catch (err) { setError(err.message); }
    finally { setSavingId(null); }
  };

  const quickApprove = async (id) => {
    setSavingId(id); setEdit(id, 'approved', true); setError('');
    try {
      const updated = await api.updateProfile(id, { approved: true });
      setProfiles(prev => prev.map(p => p.id === id ? { ...p, approved: updated.approved } : p));
    } catch (err) { setError(err.message); }
    finally { setSavingId(null); }
  };

  const deleteUser = async (p) => {
    if (!confirm(`Xóa tài khoản "${p.full_name || p.email}"?\n\nHành động này sẽ xóa hồ sơ của họ khỏi app. Họ sẽ không thể đăng nhập nữa cho tới khi đăng ký lại.`)) return;
    setDeletingId(p.id); setError('');
    try {
      await api.adminDeleteUser(p.id);
      setProfiles(prev => prev.filter(x => x.id !== p.id));
    } catch (err) { setError(err.message); }
    finally { setDeletingId(null); }
  };

  if (loading) return <div className="text-gray-400 p-4">Đang tải danh sách tài khoản...</div>;

  const pendingCount = profiles.filter(p => !p.approved && p.role !== 'admin').length;

  const filtered = profiles.filter(p => {
    const s = search.trim().toLowerCase();
    const matchSearch = !s
      || (p.full_name || '').toLowerCase().includes(s)
      || (p.email || '').toLowerCase().includes(s)
      || (edits[p.id]?.ma_sale || '').toLowerCase().includes(s);
    const matchDept = !deptFilter || edits[p.id]?.department_id === deptFilter;
    const matchRole = !roleFilter || edits[p.id]?.role === roleFilter;
    return matchSearch && matchDept && matchRole;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">👤 Quản lý tài khoản</h1>
        <button onClick={load} className="text-sm bg-gray-100 px-3 py-1.5 rounded-lg hover:bg-gray-200">🔄 Tải lại</button>
      </div>

      <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg p-3 text-sm">
        Nhân viên sale tự bấm <b>"Đăng ký"</b> ở trang đăng nhập để tạo tài khoản. Sau đó chị gán <b>Mã sale</b> và <b>Vai trò</b> cho từng người ở đây.
      </div>

      {pendingCount > 0 && (
        <div className="bg-amber-50 border border-amber-300 text-amber-800 rounded-lg p-3 text-sm font-medium">
          ⚠️ Có {pendingCount} tài khoản đang chờ duyệt.
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">{error}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Tìm theo tên, email, mã sale..."
          className="flex-1 min-w-48 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
          <option value="">Tất cả phòng ban</option>
          {deptOptions.map(([id, d]) => <option key={id} value={id}>{d.name}</option>)}
        </select>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
          <option value="">Tất cả vai trò</option>
          <option value="sale">Sale</option>
          <option value="admin">Admin</option>
        </select>
        {(search || deptFilter || roleFilter) && (
          <button onClick={() => { setSearch(''); setDeptFilter(''); setRoleFilter(''); }} className="text-sm text-gray-500 hover:text-gray-700 px-2">✕ Xóa lọc</button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5 w-14">STT</th>
              <th className="text-left px-4 py-2.5">Họ tên</th>
              <th className="text-left px-4 py-2.5">Email</th>
              <th className="text-left px-4 py-2.5">Trạng thái</th>
              <th className="text-left px-4 py-2.5">Phòng ban</th>
              <th className="text-left px-4 py-2.5">Mã sale</th>
              <th className="text-left px-4 py-2.5">Vai trò</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((p, idx) => {
              const isApproved = edits[p.id]?.approved;
              const isDeleting = deletingId === p.id;
              const deptName = departments?.[p.department_id]?.name || '';
              const missingMaSale = p.role !== 'admin' && !edits[p.id]?.ma_sale;
              return (
                <tr key={p.id} className={missingMaSale ? 'bg-red-50/50' : !isApproved ? 'bg-amber-50/40' : ''}>
                  <td className="px-4 py-2.5 text-gray-400">{idx + 1}</td>
                  <td className="px-4 py-2.5 font-medium">{p.full_name || <span className="text-gray-400">(chưa có tên)</span>}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{p.email}</td>
                  <td className="px-4 py-2.5">
                    {p.role === 'admin' ? (
                      <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">Admin</span>
                    ) : isApproved ? (
                      <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 font-medium">✓ Đã duyệt</span>
                    ) : (
                      <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-medium">⏳ Chờ duyệt</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={edits[p.id]?.department_id || ''}
                      onChange={e => setEdit(p.id, 'department_id', e.target.value)}
                      className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white max-w-[140px]"
                    >
                      <option value="">-- Chưa chọn --</option>
                      {deptOptions.map(([id, d]) => (
                        <option key={id} value={id}>{d.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <input type="text" value={edits[p.id]?.ma_sale || ''} onChange={e => setEdit(p.id, 'ma_sale', e.target.value)}
                      placeholder="VD: S01"
                      className={`border rounded-lg px-2 py-1 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-blue-400 ${missingMaSale ? 'border-red-300 bg-red-50' : 'border-gray-300'}`} />
                    {missingMaSale && <div className="text-[10px] text-red-600 mt-0.5 whitespace-nowrap">⚠️ Thiếu — cần điền</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    <select value={edits[p.id]?.role || 'sale'} onChange={e => setEdit(p.id, 'role', e.target.value)}
                      className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                      <option value="sale">Sale</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {!isApproved && (
                      <button onClick={() => quickApprove(p.id)} disabled={savingId === p.id}
                        className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-60 mr-1">
                        ✓ Duyệt
                      </button>
                    )}
                    <button onClick={() => save(p.id)} disabled={savingId === p.id}
                      className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-60 mr-1">
                      {savingId === p.id ? 'Đang lưu...' : 'Lưu'}
                    </button>
                    <button onClick={() => deleteUser(p)} disabled={isDeleting}
                      className="bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-100 disabled:opacity-60">
                      {isDeleting ? '...' : '🗑️'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center text-gray-400 py-8">{profiles.length === 0 ? 'Chưa có tài khoản nào.' : 'Không tìm thấy tài khoản phù hợp.'}</div>
        )}
      </div>
    </div>
  );
};
