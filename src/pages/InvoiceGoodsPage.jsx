// File: src/pages/InvoiceGoodsPage.jsx
import { useState, useRef, useEffect, useCallback } from 'react';
import { parseInvoiceGoodsFile } from '../utils/invoiceGoodsExcel';
import { fmtNum } from '../helpers';
import { api } from '../lib/api';
import { Pagination } from '../components/Pagination';
import { InvoiceGoodsBulkViewer } from './InvoiceGoodsBulkViewer';
import { SearchableSelect } from '../components/SearchableSelect';
import * as XLSX from 'xlsx';

const PAGE_SIZE = 50;

// Cấu hình các cột của bảng "Hàng hóa theo hóa đơn".
// - key: định danh cột (dùng làm khóa lưu độ rộng)
// - width: độ rộng mặc định (px)
// - min: độ rộng nhỏ nhất khi kéo hẹp lại (px)
// - resizable: cột có cho kéo giãn hay không (cột checkbox / cột nút Xóa thì không)
const COLS = [
  { key: 'sel',      width: 44,  min: 44,  resizable: false },
  { key: 'stt',      width: 56,  min: 44,  resizable: true  },
  { key: 'invoice',  width: 130, min: 80,  resizable: true  },
  { key: 'date',     width: 110, min: 70,  resizable: true  },
  { key: 'customer', width: 300, min: 120, resizable: true  },
  { key: 'seller',   width: 260, min: 120, resizable: true  },
  { key: 'sale',     width: 150, min: 80,  resizable: true  },
  { key: 'count',    width: 100, min: 60,  resizable: true  },
  { key: 'total',    width: 130, min: 90,  resizable: true  },
  { key: 'dossier',  width: 140, min: 90,  resizable: true  },
  { key: 'note',     width: 200, min: 120, resizable: true  },
  { key: 'action',   width: 70,  min: 60,  resizable: false },
];
const COLW_STORAGE_KEY = 'invoiceGoods.colWidths';

// Bảng invoice_goods đã lên tới hàng chục nghìn dòng — không còn tải hết về client để lọc/phân trang
// nữa (từng khiến supabase-js tự lặp request 1000 dòng/lần để lấy hết, rất chậm). Giờ dùng RPC
// list_invoice_goods_paged để lọc + phân trang ngay ở DB, chỉ tải đúng số dòng cần hiển thị.
export const InvoiceGoodsPage = ({ onBulkImport, onDelete, onDeleteMany, isAdmin = false }) => {
  const [search, setSearch] = useState('');
  const [sellerFilter, setSellerFilter] = useState('');
  const [saleFilter, setSaleFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(null); // { done, total } | null
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const fileRef = useRef(null);

  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1); // 1-indexed
  const [loading, setLoading] = useState(true);
  const [sellerOptions, setSellerOptions] = useState([]);
  const [saleOptions, setSaleOptions] = useState([]);

  // ── Độ rộng cột có thể kéo giãn/thu hẹp ─────────────────────────────
  // Lưu độ rộng từng cột theo key. Đọc lại từ localStorage để giữ nguyên
  // tùy chỉnh của người dùng qua các lần truy cập.
  const [colWidths, setColWidths] = useState(() => {
    const defaults = Object.fromEntries(COLS.map(c => [c.key, c.width]));
    try {
      const saved = JSON.parse(localStorage.getItem(COLW_STORAGE_KEY) || '{}');
      return { ...defaults, ...saved };
    } catch { return defaults; }
  });
  // Lưu lại mỗi khi độ rộng thay đổi
  useEffect(() => {
    try { localStorage.setItem(COLW_STORAGE_KEY, JSON.stringify(colWidths)); } catch {}
  }, [colWidths]);

  // Trạng thái kéo hiện tại: cột nào, vị trí chuột bắt đầu, độ rộng lúc bắt đầu
  const dragRef = useRef(null);
  const startResize = useCallback((key, e) => {
    e.preventDefault();
    e.stopPropagation();
    const col = COLS.find(c => c.key === key);
    dragRef.current = { key, startX: e.clientX, startW: colWidths[key], min: col?.min || 60 };

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const next = Math.max(d.min, d.startW + (ev.clientX - d.startX));
      setColWidths(prev => (prev[d.key] === next ? prev : { ...prev, [d.key]: next }));
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
  }, [colWidths]);

  // Nhấp đúp vào tay kéo để trả cột về độ rộng mặc định
  const resetColWidth = useCallback((key) => {
    const col = COLS.find(c => c.key === key);
    if (col) setColWidths(prev => ({ ...prev, [key]: col.width }));
  }, []);

  const maxPage = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  // Đánh dấu request đang gọi mới nhất — nếu đổi filter/trang liên tiếp nhanh, request cũ trả về
  // trễ hơn request mới sẽ bị bỏ qua, tránh ghi đè kết quả đúng bằng dữ liệu đã lỗi thời.
  const requestIdRef = useRef(0);

  // Danh sách option cho 2 dropdown lọc — tải riêng 1 lần, nhẹ, không đụng cột hàng hóa nặng
  useEffect(() => {
    api.invoiceGoodsFilterOptions()
      .then(({ sellers: s, sales }) => { setSellerOptions(s); setSaleOptions(sales); })
      .catch(() => {});
  }, []);

  const loadPage = useCallback(async (pageToLoad) => {
    const myRequestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const { rows: newRows, totalCount: tc } = await api.listInvoiceGoodsPaged({
        search, seller: sellerFilter, sale: saleFilter, dateFrom, dateTo,
        limit: PAGE_SIZE, offset: (pageToLoad - 1) * PAGE_SIZE,
      });
      if (myRequestId !== requestIdRef.current) return; // đã có request mới hơn chạy sau, bỏ kết quả này
      // Trang hiện tại vừa bị xóa hết dòng cuối (VD: xóa dòng duy nhất ở trang cuối) — lùi về trang trước
      if (newRows.length === 0 && pageToLoad > 1 && tc > 0) {
        setPage(pageToLoad - 1);
        return;
      }
      setRows(newRows);
      setTotalCount(tc);
      setPage(pageToLoad);
      // Lấy riêng trạng thái "Hoàn thành hồ sơ" cho các dòng vừa tải (không phụ thuộc hàm RPC).
      // Nếu cột chưa tồn tại trên DB thì bỏ qua, không làm hỏng danh sách.
      const ids = newRows.map(r => r.id).filter(Boolean);
      if (ids.length > 0) {
        try {
          const doneMap = await api.getInvoiceGoodsCompletedMap(ids);
          if (myRequestId === requestIdRef.current) {
            setRows(prev => prev.map(r => ({ ...r, dossier_completed: !!doneMap[r.id] })));
          }
        } catch { /* cột chưa có hoặc lỗi nhẹ — bỏ qua */ }
      }
    } catch (e) {
      console.error('Không tải được danh sách hóa đơn:', e.message);
    } finally {
      if (myRequestId === requestIdRef.current) setLoading(false);
    }
  }, [search, sellerFilter, saleFilter, dateFrom, dateTo]);

  // Gõ tìm kiếm: debounce 300ms để tránh gọi API liên tục theo từng ký tự; đổi bộ lọc luôn quay về trang 1
  useEffect(() => {
    const t = setTimeout(() => { loadPage(1); setSelectedIds(new Set()); }, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, sellerFilter, saleFilter, dateFrom, dateTo]);

  const handlePickFile = () => fileRef.current?.click();

  const [exporting, setExporting] = useState(false);
  // Xuất Excel danh sách hóa đơn theo đúng bộ lọc đang xem, kèm cột "Hoàn thành hồ sơ"
  // để chị lọc ra các hóa đơn CHƯA hoàn thành mà theo dõi/đôn đốc.
  const handleExportExcel = async () => {
    setExporting(true);
    try {
      // Lấy toàn bộ dòng theo bộ lọc hiện tại (không phân trang) — chia lô 1000 để không quá tải
      let all = [];
      let offset = 0;
      const CHUNK = 1000;
      while (true) {
        const { rows } = await api.listInvoiceGoodsPaged({
          search, seller: sellerFilter, sale: saleFilter, dateFrom, dateTo,
          limit: CHUNK, offset,
        });
        all = all.concat(rows);
        if (rows.length < CHUNK) break;
        offset += CHUNK;
        if (offset > 100000) break; // chặn an toàn
      }
      // Lấy trạng thái hoàn thành cho tất cả dòng
      let doneMap = {};
      try {
        const ids = all.map(r => r.id).filter(Boolean);
        for (let i = 0; i < ids.length; i += 500) {
          const part = await api.getInvoiceGoodsCompletedMap(ids.slice(i, i + 500));
          doneMap = { ...doneMap, ...part };
        }
      } catch { /* cột chưa có — bỏ qua */ }

      const data = all.map((r, i) => ({
        'STT': i + 1,
        'Số hóa đơn': r.invoice_no || '',
        'Ngày': r.invoice_date || '',
        'Khách hàng': r.customer_name || '',
        'Mã khách': r.customer_code || '',
        'Công ty bán': r.seller_name || '',
        'Sale': r.sale_name || '',
        'Số mặt hàng': Array.isArray(r.goods) ? r.goods.length : (r.goods ? 1 : 0),
        'Tổng tiền': Math.round(Number(r.total) || 0),
        'Hoàn thành hồ sơ': doneMap[r.id] ? 'Đã hoàn thành' : 'CHƯA hoàn thành',
        'Ghi chú': r.note || '',
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      ws['!cols'] = [
        { wch: 6 }, { wch: 16 }, { wch: 12 }, { wch: 36 }, { wch: 14 },
        { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 24 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Hoa don');
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      XLSX.writeFile(wb, `Hoa_don_theo_doi_ho_so_${today}.xlsx`);
    } catch (e) {
      alert('Không xuất được Excel: ' + e.message);
    } finally {
      setExporting(false);
    }
  };

  const toggleOne = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Chỉ áp dụng "chọn tất cả" cho các dòng đang tải sẵn (trang hiện tại), tránh chọn nhầm hàng nghìn dòng chưa tải
  const visibleIds = rows.map(inv => inv.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
  const toggleAllVisible = () => {
    setSelectedIds(prev => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        visibleIds.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...visibleIds]);
    });
  };

  const selectedInvoices = rows.filter(inv => selectedIds.has(inv.id));

  const handleFileChosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImporting(true);
    setImportProgress(null);
    try {
      const { invoices, errors } = await parseInvoiceGoodsFile(file);
      if (invoices.length === 0) {
        alert(`Không đọc được hóa đơn nào.\n\n${errors.join('\n') || 'File không có dữ liệu hợp lệ.'}`);
        return;
      }
      const proceed = confirm(
        `Tìm thấy ${invoices.length} hóa đơn trong file.` +
        (errors.length ? `\nCó ${errors.length} dòng bị bỏ qua (thiếu Số hóa đơn hoặc Tên hàng).` : '') +
        `\n\nBấm OK để nhập vào hệ thống. Số hóa đơn đã có sẽ được cập nhật đè lên dữ liệu cũ.` +
        (invoices.length > 300 ? `\n\nFile khá lớn — hệ thống sẽ nhập theo từng đợt, có thể mất vài phút, đừng tắt trình duyệt.` : '')
      );
      if (!proceed) return;

      const result = await onBulkImport(invoices, (done, total) => setImportProgress({ done, total }));
      let msg = `Đã nhập thành công ${result.success} hóa đơn.`;
      if (result.failed) msg += `\nLỗi: ${result.errors.join('\n')}`;
      alert(msg);
      await loadPage(1); // tải lại để phản ánh dữ liệu vừa nhập
    } catch (err) {
      alert('Không đọc được file: ' + err.message);
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const handleDeleteOne = async (id) => {
    const ok = await onDelete(id);
    if (ok) {
      setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
      await loadPage(page); // tải lại trang hiện tại từ server (tự lùi trang nếu vừa xóa hết dòng cuối)
    }
  };

  const handleDeleteMany = async () => {
    const ids = Array.from(selectedIds);
    const ok = await onDeleteMany(ids);
    if (ok) {
      setSelectedIds(new Set());
      await loadPage(page);
    }
  };

  const clearFilters = () => { setSearch(''); setSellerFilter(''); setSaleFilter(''); setDateFrom(''); setDateTo(''); };
  const hasActiveFilters = search || sellerFilter || saleFilter || dateFrom || dateTo;

  const [noteDrafts, setNoteDrafts] = useState({}); // { [id]: text đang gõ } — chỉ admin sửa được
  const saveNote = async (id, note) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, note } : r)); // cập nhật ngay trên giao diện
    setNoteDrafts(prev => { const next = { ...prev }; delete next[id]; return next; });
    try {
      await api.updateInvoiceGoodsNote(id, note || null);
    } catch (e) {
      alert('Không lưu được ghi chú: ' + e.message);
    }
  };

  // Tích "Hoàn thành hồ sơ" — chỉ admin. Cập nhật ngay trên giao diện rồi lưu xuống Supabase.
  const toggleCompleted = async (id, current) => {
    const next = !current;
    setRows(prev => prev.map(r => r.id === id ? { ...r, dossier_completed: next } : r));
    try {
      await api.updateInvoiceGoodsCompleted(id, next);
    } catch (e) {
      // Lỗi thì hoàn lại trạng thái cũ để không hiển thị sai
      setRows(prev => prev.map(r => r.id === id ? { ...r, dossier_completed: current } : r));
      alert('Không lưu được trạng thái hoàn thành: ' + e.message);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-800">📦 Hàng hóa theo hóa đơn</h1>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChosen} className="hidden" />
          <button onClick={handleExportExcel} disabled={exporting}
            className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 text-sm font-medium shadow disabled:opacity-50">
            {exporting ? '⏳ Đang xuất...' : '📤 Xuất Excel'}
          </button>
          <button onClick={handlePickFile} disabled={importing}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium shadow disabled:opacity-50">
            {importing
              ? (importProgress ? `⏳ Đang nhập ${importProgress.done}/${importProgress.total}...` : '⏳ Đang đọc file...')
              : '📥 Nhập Excel'}
          </button>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg p-3 text-sm mb-4">
        Nhập file Excel "Thông tin hàng hóa" (mỗi dòng là 1 mặt hàng; các dòng cùng <b>Số hóa đơn</b> sẽ tự gộp lại thành 1 hóa đơn).
        Sau khi nhập, khi tạo <b>Đơn đặt hàng</b> hoặc <b>Biên bản bàn giao</b>, chỉ cần chọn đúng Số hóa đơn là hàng hóa + giá trị sẽ tự động điền vào.
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Tìm theo số hóa đơn, mã/tên khách hàng..."
          className="flex-1 min-w-[220px] border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />

        <div className="min-w-[200px]">
          <SearchableSelect label="Công ty bán" value={sellerFilter} onChange={setSellerFilter}
            placeholder="Tất cả bên bán"
            options={[{ value: '', label: 'Tất cả bên bán' }, ...sellerOptions.map(s => ({ value: s, label: s }))]} />
        </div>

        <div className="min-w-[200px]">
          <SearchableSelect label="Sale phụ trách" value={saleFilter} onChange={setSaleFilter}
            placeholder="Tất cả Sale"
            options={[{ value: '', label: 'Tất cả Sale' }, ...saleOptions.map(s => ({ value: s, label: s }))]} />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Từ ngày</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Đến ngày</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </div>

        {hasActiveFilters && (
          <button onClick={clearFilters} className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2">✕ Xóa lọc</button>
        )}
      </div>

      {totalCount > 0 && (
        <div className="text-xs text-gray-400 mb-2">Trang {page}/{maxPage} — tổng cộng {totalCount} hóa đơn</div>
      )}

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-3">
          <div className="text-sm text-blue-800 font-medium">✓ Đã chọn {selectedIds.size} hóa đơn</div>
          <div className="flex gap-2">
            <button onClick={() => setBulkOpen(true)} className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">
              🖨️ In gộp
            </button>
            <button onClick={handleDeleteMany} className="bg-red-50 text-red-600 border border-red-200 px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-red-100">
              🗑️ Xóa gộp
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="text-sm text-blue-700 hover:underline px-2">Bỏ chọn</button>
          </div>
        </div>
      )}

      {bulkOpen && <InvoiceGoodsBulkViewer invoices={selectedInvoices} onClose={() => setBulkOpen(false)} />}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            {loading ? '⏳ Đang tải danh sách hóa đơn...' : hasActiveFilters ? 'Không tìm thấy hóa đơn phù hợp.' : 'Chưa có hóa đơn nào. Bấm "Nhập Excel" để bắt đầu.'}
          </div>
        ) : (
          <table className="text-sm table-fixed" style={{ width: COLS.reduce((s, c) => s + colWidths[c.key], 0) }}>
            {/* colgroup điều khiển độ rộng thật của từng cột theo state colWidths */}
            <colgroup>
              {COLS.map(c => <col key={c.key} style={{ width: colWidths[c.key] }} />)}
            </colgroup>
            <thead><tr className="bg-gray-50 text-gray-500 text-xs uppercase">
              {/* Mỗi ô tiêu đề (trừ cột không cho kéo) có 1 "tay kéo" ở mép phải:
                  rê chuột để đổi độ rộng, nhấp đúp để trả về mặc định. */}
              <ResizableTh col="sel"      className="px-4 py-3"                   colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="cursor-pointer" />
              </ResizableTh>
              <ResizableTh col="stt"      className="text-left px-5 py-3"          colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>STT</ResizableTh>
              <ResizableTh col="invoice"  className="text-left px-5 py-3"          colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Số hóa đơn</ResizableTh>
              <ResizableTh col="date"     className="text-left px-5 py-3"          colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Ngày</ResizableTh>
              <ResizableTh col="customer" className="text-left px-5 py-3"          colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Khách hàng</ResizableTh>
              <ResizableTh col="seller"   className="text-left px-5 py-3"          colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Công ty bán</ResizableTh>
              <ResizableTh col="sale"     className="text-left px-5 py-3"          colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Sale</ResizableTh>
              <ResizableTh col="count"    className="text-left px-5 py-3"          colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Số mặt hàng</ResizableTh>
              <ResizableTh col="total"    className="text-right px-5 py-3"         colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Tổng tiền</ResizableTh>
              <ResizableTh col="dossier"  className="text-center px-5 py-3"        colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Hoàn thành hồ sơ</ResizableTh>
              <ResizableTh col="note"     className="text-left px-5 py-3"          colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Ghi chú</ResizableTh>
              <ResizableTh col="action"   className="px-5 py-3"                    colWidths={colWidths} onResize={startResize} onReset={resetColWidth}></ResizableTh>
            </tr></thead>
            <tbody>
              {rows.map((inv, idx) => (
                <tr key={inv.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selectedIds.has(inv.id)} onChange={() => toggleOne(inv.id)} className="cursor-pointer" />
                  </td>
                  <td className="px-5 py-3 text-gray-400">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                  <td className="px-5 py-3 font-mono font-bold text-blue-600 relative group cursor-default">
                    {inv.invoice_no}
                    <div className="hidden group-hover:block absolute z-30 left-0 top-full mt-1 w-96 bg-gray-800 text-white text-xs rounded-lg shadow-xl p-3 pointer-events-none">
                      <div className="font-semibold mb-1.5">Chi tiết hàng hóa ({inv.goods?.length || 0} mặt hàng):</div>
                      <div className="space-y-1 max-h-56 overflow-y-auto">
                        {(inv.goods || []).map((g, i) => (
                          <div key={i} className="flex justify-between gap-2 border-b border-gray-700 pb-1">
                            <span className="flex-1">{i + 1}. {g.tenHang} ({g.dvt}) — SL {fmtNum(g.soLuong)} × {fmtNum(g.donGia)}</span>
                            <span className="whitespace-nowrap">{fmtNum(g.thanhTien)} đ</span>
                          </div>
                        ))}
                      </div>
                      <div className="text-right font-semibold mt-1.5 pt-1 border-t border-gray-600">Tổng: {fmtNum(inv.total || 0)} đ</div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-gray-600 truncate">{inv.invoice_date || '–'}</td>
                  <td className="px-5 py-3 text-gray-600 truncate" title={`${inv.customer_name || ''}${inv.customer_code ? ` (${inv.customer_code})` : ''}`}>{inv.customer_name || '–'}{inv.customer_code ? ` (${inv.customer_code})` : ''}</td>
                  <td className="px-5 py-3 text-gray-600 truncate" title={inv.seller_name || ''}>{inv.seller_name || '–'}</td>
                  <td className="px-5 py-3 text-gray-600 truncate" title={inv.sale_name || ''}>{inv.sale_name || <span className="text-gray-300">—</span>}</td>
                  <td className="px-5 py-3 text-gray-600">{inv.goods?.length || 0}</td>
                  <td className="px-5 py-3 text-right font-medium">{fmtNum(inv.total || 0)}</td>
                  <td className="px-5 py-3 text-center">
                    {isAdmin ? (
                      <input type="checkbox" checked={!!inv.dossier_completed}
                        onChange={() => toggleCompleted(inv.id, !!inv.dossier_completed)}
                        className="cursor-pointer w-4 h-4 accent-green-600" title="Tích khi hồ sơ đã hoàn thành" />
                    ) : (
                      inv.dossier_completed
                        ? <span className="text-green-600 font-medium" title="Hồ sơ đã hoàn thành">✓ Đã xong</span>
                        : <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-600">
                    {isAdmin ? (
                      <input
                        value={noteDrafts[inv.id] ?? inv.note ?? ''}
                        onChange={e => setNoteDrafts(prev => ({ ...prev, [inv.id]: e.target.value }))}
                        onBlur={e => { if (e.target.value !== (inv.note || '')) saveNote(inv.id, e.target.value); }}
                        placeholder="Ghi chú..."
                        className="w-full border border-transparent hover:border-gray-300 focus:border-blue-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    ) : (
                      inv.note || <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right"><button onClick={() => handleDeleteOne(inv.id)} className="text-red-500 hover:text-red-700">Xóa</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination page={page} maxPage={maxPage} onChange={loadPage} disabled={loading} />
      </div>
    </div>
  );
};

// Ô tiêu đề bảng có "tay kéo" ở mép phải để chỉnh độ rộng cột.
// - Rê chuột trên tay kéo: đổi độ rộng cột (xử lý ở onResize của trang).
// - Nhấp đúp trên tay kéo: trả cột về độ rộng mặc định (onReset).
// Cột có resizable=false (checkbox, nút Xóa) sẽ không hiện tay kéo.
function ResizableTh({ col, className = '', children, colWidths, onResize, onReset }) {
  const cfg = COLS.find(c => c.key === col);
  const canResize = cfg?.resizable;
  return (
    <th className={`relative select-none ${className}`} style={{ width: colWidths[col] }}>
      <div className="truncate">{children}</div>
      {canResize && (
        <span
          onMouseDown={(e) => onResize(col, e)}
          onDoubleClick={() => onReset(col)}
          title="Kéo để chỉnh độ rộng • Nhấp đúp để trả về mặc định"
          className="absolute top-0 right-0 h-full w-2 cursor-col-resize group flex items-center justify-center -mr-1"
        >
          {/* vạch mờ, đậm lên khi rê chuột vào, cho biết chỗ có thể kéo */}
          <span className="h-1/2 w-px bg-gray-300 group-hover:bg-blue-500 group-hover:w-0.5 transition-colors" />
        </span>
      )}
    </th>
  );
}
