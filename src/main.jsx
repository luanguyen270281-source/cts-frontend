import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import ErrorCard from './components/ErrorCard';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary
      fallback={(_error, retry) => (
        <div className="flex items-center justify-center min-h-screen text-gray-400">
          <ErrorCard
            title="Ứng dụng gặp lỗi"
            message="Đã có lỗi không mong muốn xảy ra. Bạn có thể thử lại, nếu vẫn còn lỗi hãy tải lại trang."
            onRetry={retry}
            onReload={() => window.location.reload()}
          />
        </div>
      )}
    >
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
