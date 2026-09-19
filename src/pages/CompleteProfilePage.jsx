// File: src/pages/CompleteProfilePage.jsx
// Hiện tự động với mọi tài khoản chưa điền đủ thông tin (tên + phòng ban).
// Cũng dùng làm trang "Hồ sơ của tôi" để cập nhật bất cứ lúc nào.
import { useState } from 'react';
import { api } from '../lib/api';

export const CompleteProfilePage = ({ profile, departments, onDone, isEdit = false, needsMaSale = true }) => {
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [departmentId, setDepartmentId] = useState(profile?.department_id || '');
  const [maSale, setMaSale] = useState(profile?.ma_sale || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!fullName.trim()) return setError('Vui lòng nhập họ và tên');
    if (!departmentId) return setError('Vui lòng chọn phòng ban');
    if (needsMaSale && !maSale.trim()) return setError('Vui lòng nhập Mã Sale của bạn');
    setLoading(true); setError(''); setSaved(false);
    try {
      const updated = await api.updateProfile(profile.id, {
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        department_id: departmentId,
        ma_sale: maSale.trim() || null,
      });
      if (isEdit) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
      onDone(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={isEdit ? '' : 'min-h-screen bg-gradient-to-br from-blue-900 to-blue-700 flex items-center justify-center p-4'}>
      <div className={isEdit ? 'bg-white rounded-xl shadow-sm border border-gray-200 p-6 max-w-lg' : 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8'}>
        {!isEdit && (
          <div className="text-center mb-6">
            <div className="text-3xl mb-2">👤</div>
            <h1 className="text-xl font-bold text-gray-800">Hoàn thiện hồ sơ</h1>
            <p className="text-gray-500 text-sm mt-1">Điền thông tin để admin có thể nhận ra và duyệt tài khoản của bạn</p>
          </div>
        )}

        {isEdit && (
          <h2 className="text-lg font-bold text-gray-800 mb-4">👤 Hồ sơ của tôi</h2>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Họ và tên <span className="text-red-500">*</span></label>
            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
              placeholder="Nguyễn Thị A" required
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Số điện thoại <span className="text-gray-400">(không bắt buộc)</span></label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="0901 234 567"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Phòng ban <span className="text-red-500">*</span></label>
            <select value={departmentId} onChange={e => setDepartmentId(e.target.value)} required
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
              <option value="">-- Chọn phòng ban --</option>
              {Object.entries(departments || {}).map(([id, d]) => (
                <option key={id} value={id}>{d.name}</option>
              ))}
            </select>
          </div>

          {needsMaSale && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Mã Sale <span className="text-red-500">*</span></label>
              <input type="text" value={maSale} onChange={e => setMaSale(e.target.value)}
                placeholder="VD: CTS18" required
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <p className="text-xs text-gray-400 mt-1">Mã này dùng để tự sinh số hợp đồng/đơn hàng và để bạn xem được đúng khách hàng/hợp đồng của mình.</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
            <input type="text" value={profile?.email || ''} disabled
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-gray-50 text-gray-400 cursor-not-allowed" />
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">{error}</div>}
          {saved && <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 text-sm">✓ Đã lưu thành công!</div>}

          <button type="submit" disabled={loading}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-60 transition">
            {loading ? 'Đang lưu...' : (isEdit ? '✓ Lưu thay đổi' : 'Tiếp tục')}
          </button>
        </form>
      </div>
    </div>
  );
};
