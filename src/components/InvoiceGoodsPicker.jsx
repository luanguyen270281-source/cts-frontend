// File: src/components/InvoiceGoodsPicker.jsx
import { useState, useRef, useEffect } from 'react';
import { api } from '../lib/api';

// Đổi ngày yyyy-mm-dd sang dd/mm/yyyy cho dễ đọc; giữ nguyên nếu không đúng định dạng
const fmtDateShort = (d) => {
  if (!d) return '';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
};

// Ghép nhãn hiển thị: Số hóa đơn • Ngày • Khách hàng • Công ty bán
const labelOf = (inv) => {
  const parts = [inv.invoice_no];
  if (inv.invoice_date) parts.push(fmtDateShort(inv.invoice_date));
  if (inv.customer_name) parts.push(inv.customer_name);
  if (inv.seller_name) parts.push(inv.seller_name);
  return parts.join(' • ');
};

const SEARCH_LIMIT = 50;

export const InvoiceGoodsPicker = ({ onApply }) => {
  const [selected, setSelected] = useState(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setQuery(''); }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 0); }, [open]);

  // Tìm kiếm qua RPC (server-side) thay vì lọc mảng hàng chục nghìn dòng ở client — debounce 300ms
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const rows = await api.searchInvoiceGoods(query.trim(), SEARCH_LIMIT);
        if (!cancelled) setResults(rows);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, query]);

  const pick = (inv) => { setSelected(inv); setQuery(''); setOpen(false); };
  const apply = () => { if (selected) onApply(selected); };

  return (
    <div className="flex items-center gap-2 flex-wrap bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
      <span className="text-xs text-gray-500 whitespace-nowrap">📦 Chọn số hóa đơn có sẵn:</span>
      <div ref={boxRef} className="relative min-w-[280px]">
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-blue-300">
          <span className={`truncate ${selected ? 'text-gray-800' : 'text-gray-400'}`}>
            {selected ? labelOf(selected) : '-- Chọn --'}
          </span>
          <span className="text-gray-400 ml-2 shrink-0">▾</span>
        </button>
        {open && (
          <div className="absolute z-30 mt-1 w-full min-w-[420px] bg-white border border-gray-200 rounded-lg shadow-lg flex flex-col">
            <div className="p-2 border-b border-gray-100">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="🔍 Tìm theo số hóa đơn, tên khách hàng hoặc bên bán..."
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div className="overflow-y-auto max-h-64">
              {loading ? (
                <div className="px-3 py-3 text-sm text-gray-400 text-center">Đang tìm...</div>
              ) : results.length === 0 ? (
                <div className="px-3 py-3 text-sm text-gray-400 text-center">Không tìm thấy kết quả</div>
              ) : results.map((inv) => (
                <button key={inv.id} type="button" onClick={() => pick(inv)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${inv.id === selected?.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-700'}`}>
                  {labelOf(inv)}
                </button>
              ))}
            </div>
            {/* Kết quả chạm đúng mức giới hạn tìm kiếm — rất có thể còn hóa đơn khác bị cắt, gợi ý gõ thêm cho chính xác hơn */}
            {!loading && results.length >= SEARCH_LIMIT && (
              <div className="px-3 py-2 text-xs text-amber-600 bg-amber-50 border-t border-amber-100">
                Đã hiện {SEARCH_LIMIT} kết quả đầu — có thể còn hóa đơn khác, hãy gõ thêm (VD: đủ số hóa đơn) để lọc chính xác hơn.
              </div>
            )}
          </div>
        )}
      </div>
      <button onClick={apply} disabled={!selected}
        className="bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50">
        Áp dụng
      </button>
      {selected && (
        <span className="text-xs text-gray-500">
          {selected.goods?.length || 0} mặt hàng
        </span>
      )}
    </div>
  );
};
