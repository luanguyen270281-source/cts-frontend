// File: src/components/useResizableColumns.jsx
//
// Bộ công cụ dùng chung để cho phép KÉO GIÃN / THU HẸP độ rộng các cột của một bảng.
// Dùng cho các trang danh sách dữ liệu (hợp đồng, khách hàng, dòng tiền, người dùng...).
//
// Cách dùng trong một trang:
//   1) Khai báo danh sách cột (key + độ rộng mặc định + độ rộng tối thiểu + có cho kéo không):
//        const COLS = [
//          { key: 'stt',  width: 56,  min: 44, resizable: true },
//          { key: 'name', width: 240, min: 120, resizable: true },
//          ...
//        ];
//   2) Trong component gọi hook:
//        const rt = useResizableColumns(COLS, 'contractList.colWidths');
//   3) Trong JSX của bảng:
//        <table className="text-sm table-fixed" style={{ width: rt.totalWidth }}>
//          <ResizableColgroup rt={rt} />
//          <thead><tr ...>
//            <ResizableTh rt={rt} col="stt" className="text-left px-4 py-3">STT</ResizableTh>
//            ...
//          </tr></thead>
//          <tbody> ...các <td> giữ nguyên... </tbody>
//        </table>
//
// Ghi chú:
//  - Độ rộng được lưu vào localStorage theo storageKey nên giữ nguyên qua các lần truy cập.
//  - Rê chuột trên mép phải tiêu đề cột để đổi độ rộng; nhấp đúp để trả về mặc định.
//  - Cột resizable=false (checkbox, nút thao tác) sẽ không hiện tay kéo.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

export function useResizableColumns(cols, storageKey) {
  const defaults = useMemo(
    () => Object.fromEntries(cols.map(c => [c.key, c.width])),
    [cols]
  );

  const [widths, setWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return { ...defaults, ...saved };
    } catch {
      return defaults;
    }
  });

  // Nếu cấu hình cột đổi (thêm/bớt cột) thì bổ sung khóa mới còn thiếu
  useEffect(() => {
    setWidths(prev => {
      let changed = false;
      const next = { ...prev };
      for (const c of cols) {
        if (next[c.key] == null) { next[c.key] = c.width; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [cols]);

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(widths)); } catch {}
  }, [widths, storageKey]);

  const dragRef = useRef(null);

  const startResize = useCallback((key, e) => {
    e.preventDefault();
    e.stopPropagation();
    const col = cols.find(c => c.key === key);
    dragRef.current = { key, startX: e.clientX, startW: widths[key], min: col?.min || 60 };

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const next = Math.max(d.min, d.startW + (ev.clientX - d.startX));
      setWidths(prev => (prev[d.key] === next ? prev : { ...prev, [d.key]: next }));
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [cols, widths]);

  const resetWidth = useCallback((key) => {
    const col = cols.find(c => c.key === key);
    if (col) setWidths(prev => ({ ...prev, [key]: col.width }));
  }, [cols]);

  const totalWidth = useMemo(
    () => cols.reduce((s, c) => s + (widths[c.key] || c.width), 0),
    [cols, widths]
  );

  return { cols, widths, startResize, resetWidth, totalWidth };
}

// <colgroup> điều khiển độ rộng thật của từng cột theo state.
export function ResizableColgroup({ rt }) {
  return (
    <colgroup>
      {rt.cols.map(c => (
        <col key={c.key} style={{ width: rt.widths[c.key] }} />
      ))}
    </colgroup>
  );
}

// Ô tiêu đề bảng có "tay kéo" ở mép phải để chỉnh độ rộng cột.
export function ResizableTh({ rt, col, className = '', children, ...rest }) {
  const cfg = rt.cols.find(c => c.key === col);
  const canResize = cfg?.resizable;
  return (
    <th className={`relative select-none ${className}`} style={{ width: rt.widths[col] }} {...rest}>
      <div className="truncate">{children}</div>
      {canResize && (
        <span
          onMouseDown={(e) => rt.startResize(col, e)}
          onDoubleClick={() => rt.resetWidth(col)}
          title="Kéo để chỉnh độ rộng • Nhấp đúp để trả về mặc định"
          className="absolute top-0 right-0 h-full w-2 cursor-col-resize group flex items-center justify-center -mr-1 z-10"
        >
          <span className="h-1/2 w-px bg-gray-300 group-hover:bg-blue-500 group-hover:w-0.5 transition-colors" />
        </span>
      )}
    </th>
  );
}
