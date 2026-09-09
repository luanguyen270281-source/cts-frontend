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
