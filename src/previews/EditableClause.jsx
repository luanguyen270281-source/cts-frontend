// File: src/previews/EditableClause.jsx
import { useState } from 'react';

// Hiển thị 1 điều khoản (tiêu đề + nội dung); nếu có onSave thì cho sửa tại chỗ — icon ✏️ đặt ngay
// cạnh tiêu đề (dễ nhận biết hơn để giữa đoạn văn) → bấm vào hiện ô sửa (contentEditable, không dùng
// <textarea> vì In/PDF/Word đều lấy trực tiếp innerHTML của vùng preview để xuất file) + Lưu/Hủy.
export const EditableClause = ({ heading, value, onSave, className = '', style }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  const Heading = ({ showIcon }) => (
    <div className="font-bold uppercase flex items-center gap-1.5">
      {heading}
      {showIcon && (
        <button
          onClick={() => { setDraft(value); setEditing(true); }}
          className="no-print text-blue-500 hover:text-blue-700 opacity-60 hover:opacity-100 text-sm normal-case font-normal"
          title="Sửa điều khoản này"
        >
          ✏️
        </button>
      )}
    </div>
  );

  if (!onSave) {
    return (
      <>
        <Heading showIcon={false} />
        <div className={className} style={{ whiteSpace: 'pre-line', ...style }}>{value}</div>
      </>
    );
  }

  if (editing) {
    const handleSave = async () => {
      setSaving(true);
      try {
        await onSave(draft);
        setEditing(false);
      } catch (err) {
        alert(err.message || 'Lưu thất bại.');
      } finally {
        setSaving(false);
      }
    };
    return (
      <div className="no-print">
        <Heading showIcon={false} />
        <div
          contentEditable
          suppressContentEditableWarning
          onInput={e => setDraft(e.currentTarget.innerText)}
          className={`${className} border border-blue-300 rounded p-2 bg-blue-50/50 outline-none focus:ring-2 focus:ring-blue-300`}
          style={{ whiteSpace: 'pre-line', ...style }}
        >
          {value}
        </div>
        <div className="mt-1.5 flex gap-2">
          <button onClick={handleSave} disabled={saving}
            className="text-xs bg-green-600 text-white px-2.5 py-1 rounded hover:bg-green-700 disabled:opacity-50">
            {saving ? '⏳ Đang lưu...' : '✓ Lưu'}
          </button>
          <button onClick={() => setEditing(false)} disabled={saving}
            className="text-xs bg-gray-200 text-gray-700 px-2.5 py-1 rounded hover:bg-gray-300 disabled:opacity-50">
            ✕ Hủy
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Heading showIcon={true} />
      <div className={className} style={{ whiteSpace: 'pre-line', ...style }}>{value}</div>
    </>
  );
};
