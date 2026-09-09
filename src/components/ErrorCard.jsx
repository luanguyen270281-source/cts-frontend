// File: src/components/ErrorCard.jsx
// Khối nội dung lỗi dùng chung (icon + tiêu đề + mô tả + nút hành động) —
// vị trí/khung bao ngoài (toàn màn hình, giữa trang, hay overlay modal) do nơi gọi tự quyết định.
export default function ErrorCard({
  icon = '⚠️',
  title,
  message,
  onRetry,
  retryLabel = '🔄 Thử lại',
  onReload,
  reloadLabel = '🔄 Tải lại trang',
  extraActions,
}) {
  return (
    <div className="text-center max-w-sm px-4">
      <div className="text-4xl mb-3">{icon}</div>
      {title && <div className="text-gray-700 font-medium mb-1">{title}</div>}
      {message && <div className="text-sm text-gray-500 mb-4">{message}</div>}
      <div className="flex gap-2 justify-center flex-wrap">
        {onRetry && (
          <button onClick={onRetry}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium shadow">
            {retryLabel}
          </button>
        )}
        {onReload && (
          <button onClick={onReload}
            className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 text-sm font-medium">
            {reloadLabel}
          </button>
        )}
        {extraActions}
      </div>
    </div>
  );
}
