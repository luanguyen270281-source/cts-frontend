// File: src/components/ErrorBoundary.jsx
// Chặn lỗi render ở 1 nhánh cây component để không làm trắng toàn bộ app.
// React chỉ bắt được lỗi này qua class component (chưa có hook tương đương).
//
// Muốn tự động "quên" lỗi cũ khi chuyển sang nội dung khác (đổi trang, đổi hợp đồng đang xem):
// truyền `key` (chuẩn React) cho chính <ErrorBoundary>, không dùng prop riêng — đổi key sẽ
// unmount + mount lại toàn bộ, tự nhiên có state hasError=false, không cần code thêm.
import React from 'react';
import ErrorCard from './ErrorCard';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary bắt được lỗi:', error, info?.componentStack);
    // Sau mỗi lần deploy, tên file chunk đổi hash → tab đang mở từ bản cũ import file không còn tồn tại
    // (Vercel trả index.html thay vì JS). Tải lại trang là lấy được bản mới; chỉ tự reload 1 lần / 1 phút
    // để không lặp vô hạn nếu lỗi thật sự là do nguyên nhân khác.
    const msg = String(error?.message || '');
    if (/dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i.test(msg)) {
      try {
        const last = Number(sessionStorage.getItem('chunk_reload_at') || 0);
        if (Date.now() - last > 60000) {
          sessionStorage.setItem('chunk_reload_at', String(Date.now()));
          window.location.reload();
        }
      } catch { /* sessionStorage bị chặn: bỏ qua, người dùng bấm Tải lại trang thủ công */ }
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.handleRetry);
      return (
        <div className="flex items-center justify-center min-h-[60vh] text-gray-400">
          <ErrorCard
            title="Trang này gặp lỗi"
            message="Đã có lỗi xảy ra khi hiển thị trang này. Bạn có thể thử lại, tải lại trang, hoặc chuyển sang trang khác ở menu bên trái."
            onRetry={this.handleRetry}
            onReload={() => window.location.reload()}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
