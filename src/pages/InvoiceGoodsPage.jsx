// File: src/pages/InvoiceGoodsPage.jsx
import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
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
  { key: 'stt',      width: 70,  min: 64,  resizable: true  },
  // Cột đóng băng (sticky) — bỏ resize để tránh tay kéo (vùng hover riêng ở mép phải) chồng lên
  // viền phân tách cột đóng băng, tạo cảm giác có 1 đoạn thừa/trống ở tiêu đề.
  { key: 'invoice',  width: 130, min: 80,  resizable: false },
  { key: 'date',     width: 110, min: 70,  resizable: true  },
  { key: 'customer', width: 300, min: 120, resizable: true  },
  { key: 'seller',   width: 260, min: 120, resizable: true  },
  { key: 'sale',     width: 150, min: 80,  resizable: true  },
  { key: 'count',    width: 130, min: 60,  resizable: true  },
  { key: 'total',    width: 130, min: 90,  resizable: true  },
  { key: 'dossier',  width: 180, min: 90,  resizable: true  },
  { key: 'note',     width: 200, min: 120, resizable: true  },
  // 7 cột theo dõi hồ sơ SALE GỬI → NHÂN SỰ GỬI → KẾ TOÁN NHẬN — để cuối bảng, trước cột Xóa.
  // Độ rộng các cột "Ngày ..." và "Hạn (số ngày)" đủ rộng để tiêu đề nằm gọn 1 dòng, không
  // xuống dòng lệch nhau giữa các cột (so le rất khó nhìn).
  { key: 'sale_sent',                width: 110, min: 90,  resizable: true },
  { key: 'sale_sent_date',           width: 160, min: 110, resizable: true },
  { key: 'hr_sent',                  width: 110, min: 90,  resizable: true },
  { key: 'hr_sent_date',             width: 190, min: 110, resizable: true },
  { key: 'accounting_received',      width: 110, min: 90,  resizable: true },
  { key: 'accounting_received_date', width: 190, min: 110, resizable: true },
  { key: 'deadline_days',            width: 130, min: 90,  resizable: true },
  { key: 'action',   width: 70,  min: 60,  resizable: false },
];
// Đổi tên key (thêm .v2) khi đổi độ rộng mặc định trong COLS — nếu giữ nguyên tên cũ, độ rộng
// đã lưu sẵn trong trình duyệt của người đã từng mở trang này sẽ đè lên, khiến mặc định mới
// không bao giờ áp dụng được cho tới khi họ tự kéo/reset lại từng cột.
const COLW_STORAGE_KEY = 'invoiceGoods.colWidths.v3';

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
      const merged = { ...defaults, ...saved };
      // Kẹp về đúng khoảng min cho phép — phòng trường hợp giá trị đã lưu (từ 1 lần kéo cũ, hoặc
      // từ trước khi tăng "min" của 1 cột nào đó) nhỏ hơn mức tối thiểu hiện tại, khiến tiêu đề
      // luôn bị vỡ dòng xấu dù COLS đã đổi default. Không tin mù quáng vào giá trị đã lưu.
      COLS.forEach(c => { if (merged[c.key] < c.min) merged[c.key] = c.min; });
      return merged;
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

  // ── Thanh cuộn ngang phụ ở TRÊN đầu bảng ─────────────────────────────
  // Bảng có thể tới 50 dòng/trang, rất dài — nếu chỉ có 1 thanh cuộn ngang ở tận đáy bảng thì phải
  // cuộn dọc xuống hết mới cuộn ngang được. Thêm 1 thanh mảnh ngay trên đầu bảng, đồng bộ 2 chiều
  // với thanh cuộn thật (kéo thanh nào cũng được, cả 2 luôn khớp nhau).
  const topScrollRef = useRef(null);
  const tableScrollRef = useRef(null);
  const tableElRef = useRef(null);
  const [tableRenderWidth, setTableRenderWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const syncingRef = useRef(false); // chặn 2 bên tự đẩy qua đẩy lại vô hạn khi đồng bộ

  useLayoutEffect(() => {
    const tableEl = tableElRef.current;
    const containerEl = tableScrollRef.current;
    if (!tableEl || !containerEl || typeof ResizeObserver === 'undefined') return;
    const roTable = new ResizeObserver(([entry]) => setTableRenderWidth(entry.contentRect.width));
    const roContainer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    roTable.observe(tableEl);
    roContainer.observe(containerEl);
    return () => { roTable.disconnect(); roContainer.disconnect(); };
  }, [rows.length]);

  // Chỉ hiện viền phân tách ở mép cột đóng băng khi THỰC SỰ đang cần cuộn ngang (bảng rộng hơn
  // khung nhìn) — màn đủ rộng để hiện hết bảng thì không cần viền này, đỡ rối mắt không cần thiết.
  const needsHScroll = containerWidth > 0 && tableRenderWidth > containerWidth + 1;

  const syncScroll = (fromRef, toRef) => () => {
    if (syncingRef.current || !fromRef.current || !toRef.current) return;
    syncingRef.current = true;
    toRef.current.scrollLeft = fromRef.current.scrollLeft;
    syncingRef.current = false;
  };

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
      // Lấy riêng "Hoàn thành hồ sơ" + 7 cột theo dõi hồ sơ cho các dòng vừa tải (không phụ thuộc
      // hàm RPC). Nếu cột chưa tồn tại trên DB thì bỏ qua, không làm hỏng danh sách.
      const ids = newRows.map(r => r.id).filter(Boolean);
      if (ids.length > 0) {
        const extraMap = await api.getInvoiceGoodsExtraMap(ids).catch(() => ({}));
        if (myRequestId === requestIdRef.current) {
          setRows(prev => prev.map(r => {
            const extra = extraMap[r.id] || {};
            return { ...r, ...extra, dossier_completed: !!extra.dossier_completed };
          }));
        }
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
      // Lấy trạng thái hoàn thành + 7 cột theo dõi hồ sơ cho tất cả dòng, 1 lệnh gọi/lô (không
      // tách riêng 2 map như trước — cùng bảng, cùng danh sách id, gộp lại đỡ tốn round-trip).
      let extraMap = {};
      const ids = all.map(r => r.id).filter(Boolean);
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const part = await api.getInvoiceGoodsExtraMap(chunk).catch(() => ({}));
        extraMap = { ...extraMap, ...part };
      }

      const data = all.map((r, i) => {
        const w = extraMap[r.id] || {};
        return {
          'STT': i + 1,
          'Số hóa đơn': r.invoice_no || '',
          'Ngày': r.invoice_date || '',
          'Khách hàng': r.customer_name || '',
          'Mã khách': r.customer_code || '',
          'Công ty bán': r.seller_name || '',
          'Sale': r.sale_name || '',
          'Số mặt hàng': Array.isArray(r.goods) ? r.goods.length : (r.goods ? 1 : 0),
          'Tổng tiền': Math.round(Number(r.total) || 0),
          'Hoàn thành hồ sơ': w.dossier_completed ? 'Đã hoàn thành' : 'CHƯA hoàn thành',
          'Ghi chú': r.note || '',
          'Sale gửi': w.sale_sent ? 'Đã gửi' : 'Chưa gửi',
          'Ngày Sale gửi': w.sale_sent_date || '',
          'Nhân sự gửi': w.hr_sent ? 'Đã gửi' : 'Chưa gửi',
          'Ngày Nhân sự gửi': w.hr_sent_date || '',
          'Kế toán nhận': w.accounting_received ? 'Đã nhận' : 'Chưa nhận',
          'Ngày Kế toán nhận': w.accounting_received_date || '',
          'Hạn (số ngày)': w.deadline_days ?? '',
        };
      });

      const ws = XLSX.utils.json_to_sheet(data);
      ws['!cols'] = [
        { wch: 6 }, { wch: 16 }, { wch: 12 }, { wch: 36 }, { wch: 14 },
        { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 18 },
        { wch: 24 },
        { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 12 },
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

  // Tích/chọn ngày/gõ số cho 7 cột theo dõi hồ sơ SALE GỬI / NHÂN SỰ GỬI / KẾ TOÁN NHẬN — chỉ admin.
  // Cập nhật ngay trên giao diện rồi lưu xuống Supabase, giống hệt "Hoàn thành hồ sơ".
  const [hanDrafts, setHanDrafts] = useState({}); // { [id]: text đang gõ cho "Hạn (số ngày)" }

  // Trạng thái "đang lưu"/"vừa lưu xong" theo từng ô (id + field) — để hiện chấm xoay + khóa tạm
  // ô đó (tránh bấm 2 lần chồng nhau) trong lúc chờ Supabase, và chớp xanh nhẹ khi lưu xong.
  // 1 map duy nhất (không phải 2 Set riêng) — 1 ô chỉ ở đúng 1 trạng thái tại 1 thời điểm,
  // tránh khoảng khắc "vừa saving vừa saved" cùng true nếu tách 2 Set độc lập.
  const [cellStatus, setCellStatus] = useState({}); // { [id:field]: 'saving' | 'saved' }
  const cellKey = (id, field) => `${id}:${field}`;
  const markSaving = (id, field) => setCellStatus(prev => ({ ...prev, [cellKey(id, field)]: 'saving' }));
  const unmarkSaving = (id, field) => setCellStatus(prev => {
    if (prev[cellKey(id, field)] !== 'saving') return prev; // đã bị flashSaved ghi đè 'saved' rồi, đừng xóa nhầm
    const next = { ...prev }; delete next[cellKey(id, field)]; return next;
  });
  const flashSaved = (id, field) => {
    const key = cellKey(id, field);
    setCellStatus(prev => ({ ...prev, [key]: 'saved' }));
    setTimeout(() => setCellStatus(prev => {
      if (prev[key] !== 'saved') return prev;
      const next = { ...prev }; delete next[key]; return next;
    }), 500);
  };

  const toggleWorkflowFlag = async (id, field, current) => {
    const next = !current;
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: next } : r));
    markSaving(id, field);
    try {
      await api.updateInvoiceGoodsWorkflowField(id, field, next);
      flashSaved(id, field);
    } catch (e) {
      setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: current } : r));
      alert('Không lưu được: ' + e.message);
    } finally {
      unmarkSaving(id, field);
    }
  };

  const saveWorkflowDate = async (id, field, value, current) => {
    const next = value || null;
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: next } : r));
    markSaving(id, field);
    try {
      await api.updateInvoiceGoodsWorkflowField(id, field, next);
      flashSaved(id, field);
    } catch (e) {
      setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: current } : r));
      alert('Không lưu được ngày: ' + e.message);
    } finally {
      unmarkSaving(id, field);
    }
  };

  const saveWorkflowHan = async (id, value, current) => {
    const trimmed = value.trim();
    let num = null;
    if (trimmed !== '') {
      // Number() (không phải parseInt) — parseInt("12abc") trả về 12 thay vì báo lỗi, dễ lưu
      // nhầm số sai; Number("12abc") trả NaN nên bị Number.isInteger chặn đúng như mong đợi.
      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed < 0) {
        alert('Hạn (số ngày) phải là số nguyên không âm.');
        setHanDrafts(prev => { const next = { ...prev }; delete next[id]; return next; });
        return;
      }
      num = parsed;
    }
    setRows(prev => prev.map(r => r.id === id ? { ...r, deadline_days: num } : r));
    setHanDrafts(prev => { const next = { ...prev }; delete next[id]; return next; });
    markSaving(id, 'deadline_days');
    try {
      await api.updateInvoiceGoodsWorkflowField(id, 'deadline_days', num);
      flashSaved(id, 'deadline_days');
    } catch (e) {
      setRows(prev => prev.map(r => r.id === id ? { ...r, deadline_days: current } : r));
      alert('Không lưu được hạn số ngày: ' + e.message);
    } finally {
      unmarkSaving(id, 'deadline_days');
    }
  };

  // Quá hạn: đã có "Hạn (số ngày)" tính từ "Ngày Sale gửi" mà tới hôm nay đã vượt, và hồ sơ chưa
  // xong (Kế toán chưa nhận) — không lưu vào DB, tự tính lại mỗi lần hiển thị theo ngày hiện tại.
  const isOverdue = (inv) => {
    if (inv.accounting_received) return false;
    // Bắt buộc kiểm tra cả checkbox "Sale gửi", không chỉ ngày — 2 ô này sửa độc lập với nhau
    // (tích/bỏ tích không tự xóa ngày), nên nếu chỉ dựa vào ngày, lỡ bỏ tích "Sale gửi" mà quên
    // xóa ngày thì vẫn bị báo "Quá hạn" sai, dù trên bảng đang hiện rõ là "chưa gửi".
    if (!inv.sale_sent || !inv.sale_sent_date || inv.deadline_days == null) return false;
    // Thêm "T00:00:00" để parse theo giờ địa phương — cùng cách helpers.js (fmtDate/fmtYYMMDD)
    // đang dùng cho vấn đề này, tránh new Date('yyyy-mm-dd') tự parse theo UTC gây lệch ngày.
    const sent = new Date(inv.sale_sent_date + 'T00:00:00');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((today.getTime() - sent.getTime()) / 86400000);
    return days > inv.deadline_days;
  };

  // Đóng băng 3 cột đầu (Chọn, STT, Số hóa đơn) khi cuộn ngang — phải đóng băng liền khối từ mép
  // trái (không thể đóng băng 1 cột nằm giữa bảng), để luôn biết đang xem hóa đơn nào dù đã cuộn
  // sang xem các cột bên phải. Tính vị trí "left" từng cột dựa theo độ rộng cột hiện tại (có thể
  // đã bị người dùng kéo giãn), không hardcode số cứng.
  const frozenLeft = { sel: 0, stt: colWidths.sel, invoice: colWidths.sel + colWidths.stt };

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
            className={`border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 ${dateFrom ? '' : 'wf-date-empty'}`} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Đến ngày</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className={`border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 ${dateTo ? '' : 'wf-date-empty'}`} />
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

      {/* 1 khối card duy nhất (viền/bo góc/đổ bóng dùng chung) chứa: thanh cuộn ngang mảnh ở trên
          (đồng bộ 2 chiều với thanh cuộn thật của bảng, để không phải cuộn dọc xuống tận đáy 50
          dòng mới cuộn ngang được) + phần bảng thật bên dưới — nhìn liền 1 khối, không tách rời. */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {rows.length > 0 && (
          <div
            ref={topScrollRef}
            onScroll={syncScroll(topScrollRef, tableScrollRef)}
            className="wide-table-scroll overflow-x-auto overflow-y-hidden border-b border-gray-200 bg-gray-50"
            style={{ height: 14 }}
          >
            <div style={{ width: tableRenderWidth, height: 1 }} />
          </div>
        )}

        {/* Bảng nhiều cột hơn bề ngang màn hình — overflow-x-auto cho cuộn ngang, kèm class
            "wide-table-scroll" (định nghĩa ở index.css) để thanh cuộn ngang hiện rõ ràng, không bị
            chìm/khó thấy như thanh cuộn mặc định của trình duyệt, giúp người dùng biết còn cột ẩn bên phải. */}
        <div
          ref={tableScrollRef}
          onScroll={syncScroll(tableScrollRef, topScrollRef)}
          className="wide-table-scroll overflow-x-auto"
        >
        {rows.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            {loading ? '⏳ Đang tải danh sách hóa đơn...' : hasActiveFilters ? 'Không tìm thấy hóa đơn phù hợp.' : 'Chưa có hóa đơn nào. Bấm "Nhập Excel" để bắt đầu.'}
          </div>
        ) : (
          // width: '100%' + minWidth: tổng độ rộng cột — màn rộng thì bảng giãn lấp đầy khoảng trống
          // (các cột giãn theo tỉ lệ), màn hẹp hơn tổng độ rộng cột thì bảng giữ đúng độ rộng đó và
          // overflow-x-auto ở div cha lo việc cuộn ngang, không co bảng lại làm cột bị bóp méo.
          <table ref={tableElRef} className="text-sm table-fixed" style={{ width: '100%', minWidth: COLS.reduce((s, c) => s + colWidths[c.key], 0) }}>
            {/* colgroup điều khiển độ rộng thật của từng cột theo state colWidths */}
            <colgroup>
              {COLS.map(c => <col key={c.key} style={{ width: colWidths[c.key] }} />)}
            </colgroup>
            <thead><tr className="bg-gray-50 text-gray-500 text-xs uppercase">
              {/* Mỗi ô tiêu đề (trừ cột không cho kéo) có 1 "tay kéo" ở mép phải:
                  rê chuột để đổi độ rộng, nhấp đúp để trả về mặc định. */}
              <ResizableTh col="sel"      className="px-4 py-3"                   colWidths={colWidths} onResize={startResize} onReset={resetColWidth} sticky left={frozenLeft.sel}>
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="cursor-pointer" />
              </ResizableTh>
              <ResizableTh col="stt"      className="text-left px-5 py-3"          colWidths={colWidths} onResize={startResize} onReset={resetColWidth} sticky left={frozenLeft.stt}>STT</ResizableTh>
              <ResizableTh col="invoice"  className="text-left px-5 py-3" colWidths={colWidths} onResize={startResize} onReset={resetColWidth} sticky left={frozenLeft.invoice} dividerRight={needsHScroll}>Số hóa đơn</ResizableTh>
              <ResizableTh col="date"     className="text-left px-5 py-3"          colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Ngày</ResizableTh>
              <ResizableTh col="customer" className="text-left px-5 py-3"          colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Khách hàng</ResizableTh>
              <ResizableTh col="seller"   className="text-left px-5 py-3"          colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Công ty bán</ResizableTh>
              <ResizableTh col="sale"     className="text-left px-5 py-3"          colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Sale</ResizableTh>
              <ResizableTh col="count"    className="text-left px-5 py-3"          colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Số mặt hàng</ResizableTh>
              <ResizableTh col="total"    className="text-right px-5 py-3"         colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Tổng tiền</ResizableTh>
              <ResizableTh col="dossier"  className="text-center px-5 py-3"        colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Hoàn thành hồ sơ</ResizableTh>
              <ResizableTh col="note"     className="text-left px-5 py-3"          colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Ghi chú</ResizableTh>
              <ResizableTh col="sale_sent"                 className="text-center px-3 py-3" colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Sale gửi</ResizableTh>
              <ResizableTh col="sale_sent_date"            className="text-left px-3 py-3"   colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Ngày Sale gửi</ResizableTh>
              <ResizableTh col="hr_sent"                   className="text-center px-3 py-3" colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Nhân sự gửi</ResizableTh>
              <ResizableTh col="hr_sent_date"               className="text-left px-3 py-3"   colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Ngày Nhân sự gửi</ResizableTh>
              <ResizableTh col="accounting_received"       className="text-center px-3 py-3" colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Kế toán nhận</ResizableTh>
              <ResizableTh col="accounting_received_date"  className="text-left px-3 py-3"   colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Ngày Kế toán nhận</ResizableTh>
              <ResizableTh col="deadline_days"              className="text-center px-3 py-3" colWidths={colWidths} onResize={startResize} onReset={resetColWidth}>Hạn (số ngày)</ResizableTh>
              <ResizableTh col="action"   className="px-5 py-3"                    colWidths={colWidths} onResize={startResize} onReset={resetColWidth}></ResizableTh>
            </tr></thead>
            <tbody>
              {rows.map((inv, idx) => {
                // Ô đóng băng (sticky) tự đặt nền riêng để nội dung cuộn qua bên dưới không lộ ra —
                // phải tô cùng màu đỏ khi quá hạn, nếu không dòng quá hạn chỉ đỏ ở các cột không đóng băng.
                const overdue = isOverdue(inv);
                const stickyBg = overdue ? 'bg-red-50 group-hover/row:bg-red-100' : 'bg-white group-hover/row:bg-gray-50';
                return (
                <tr key={inv.id} className={`group/row border-t border-gray-100 ${overdue ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'}`}>
                  <td className={`sticky z-10 ${stickyBg} px-4 py-3`} style={{ left: frozenLeft.sel }}>
                    <input type="checkbox" checked={selectedIds.has(inv.id)} onChange={() => toggleOne(inv.id)} className="cursor-pointer" />
                  </td>
                  <td className={`sticky z-10 ${stickyBg} px-5 py-3 text-gray-400`} style={{ left: frozenLeft.stt }}>{(page - 1) * PAGE_SIZE + idx + 1}</td>
                  {/* hover:z-40 (không phải group-hover) — khi hover đúng ô này, tự nâng cả stacking
                      context của nó (kể cả tooltip lồng bên trong) lên trên các ô đóng băng z-10 của
                      NHỮNG DÒNG KHÁC, tránh bị viền/nền của các dòng dưới đè ngang qua tooltip. */}
                  <td className={`group/cell sticky z-10 hover:z-40 ${stickyBg} px-5 py-3 font-mono font-bold text-blue-600 relative cursor-default`} style={{ left: frozenLeft.invoice }}>
                    {inv.invoice_no}
                    {/* Div nền màu thay vì border-right — border bị lỗi trình duyệt, mất ngay khi cuộn ngang trên ô sticky */}
                    {needsHScroll && <div className="absolute top-0 right-0 h-full w-0.5 bg-gray-300" />}
                    <div className="hidden group-hover/cell:block absolute z-30 left-0 top-full mt-1 w-96 bg-gray-800 text-white text-xs rounded-lg shadow-xl p-3 pointer-events-none">
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
                  {/* 7 cột theo dõi hồ sơ: Sale (không chỉ Admin) cũng sửa được — DB có trigger riêng
                      chặn non-admin sửa các cột khác (số tiền, hàng hóa...) ngoài 7 cột này. */}
                  <td className="px-3 py-3 text-center">
                    <WorkflowCell saving={cellStatus[cellKey(inv.id, 'sale_sent')] === 'saving'} saved={cellStatus[cellKey(inv.id, 'sale_sent')] === 'saved'}>
                      <input type="checkbox" checked={!!inv.sale_sent} disabled={cellStatus[cellKey(inv.id, 'sale_sent')] === 'saving'}
                        onChange={() => toggleWorkflowFlag(inv.id, 'sale_sent', !!inv.sale_sent)}
                        className="cursor-pointer w-4 h-4 accent-blue-600" title="Tích khi Sale đã gửi hồ sơ" />
                    </WorkflowCell>
                  </td>
                  <td className="px-3 py-3">
                    <WorkflowCell saving={cellStatus[cellKey(inv.id, 'sale_sent_date')] === 'saving'} saved={cellStatus[cellKey(inv.id, 'sale_sent_date')] === 'saved'}>
                      <input type="date" value={inv.sale_sent_date || ''} disabled={cellStatus[cellKey(inv.id, 'sale_sent_date')] === 'saving'}
                        onChange={e => saveWorkflowDate(inv.id, 'sale_sent_date', e.target.value, inv.sale_sent_date)}
                        className={`w-full border border-transparent hover:border-gray-300 focus:border-blue-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 ${inv.sale_sent_date ? '' : 'wf-date-empty'}`} />
                    </WorkflowCell>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <WorkflowCell saving={cellStatus[cellKey(inv.id, 'hr_sent')] === 'saving'} saved={cellStatus[cellKey(inv.id, 'hr_sent')] === 'saved'}>
                      <input type="checkbox" checked={!!inv.hr_sent} disabled={cellStatus[cellKey(inv.id, 'hr_sent')] === 'saving'}
                        onChange={() => toggleWorkflowFlag(inv.id, 'hr_sent', !!inv.hr_sent)}
                        className="cursor-pointer w-4 h-4 accent-blue-600" title="Tích khi Nhân sự đã gửi hồ sơ" />
                    </WorkflowCell>
                  </td>
                  <td className="px-3 py-3">
                    <WorkflowCell saving={cellStatus[cellKey(inv.id, 'hr_sent_date')] === 'saving'} saved={cellStatus[cellKey(inv.id, 'hr_sent_date')] === 'saved'}>
                      <input type="date" value={inv.hr_sent_date || ''} disabled={cellStatus[cellKey(inv.id, 'hr_sent_date')] === 'saving'}
                        onChange={e => saveWorkflowDate(inv.id, 'hr_sent_date', e.target.value, inv.hr_sent_date)}
                        className={`w-full border border-transparent hover:border-gray-300 focus:border-blue-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 ${inv.hr_sent_date ? '' : 'wf-date-empty'}`} />
                    </WorkflowCell>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <WorkflowCell saving={cellStatus[cellKey(inv.id, 'accounting_received')] === 'saving'} saved={cellStatus[cellKey(inv.id, 'accounting_received')] === 'saved'}>
                      <input type="checkbox" checked={!!inv.accounting_received} disabled={cellStatus[cellKey(inv.id, 'accounting_received')] === 'saving'}
                        onChange={() => toggleWorkflowFlag(inv.id, 'accounting_received', !!inv.accounting_received)}
                        className="cursor-pointer w-4 h-4 accent-green-600" title="Tích khi Kế toán đã nhận hồ sơ" />
                    </WorkflowCell>
                  </td>
                  <td className="px-3 py-3">
                    <WorkflowCell saving={cellStatus[cellKey(inv.id, 'accounting_received_date')] === 'saving'} saved={cellStatus[cellKey(inv.id, 'accounting_received_date')] === 'saved'}>
                      <input type="date" value={inv.accounting_received_date || ''} disabled={cellStatus[cellKey(inv.id, 'accounting_received_date')] === 'saving'}
                        onChange={e => saveWorkflowDate(inv.id, 'accounting_received_date', e.target.value, inv.accounting_received_date)}
                        className={`w-full border border-transparent hover:border-gray-300 focus:border-blue-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 ${inv.accounting_received_date ? '' : 'wf-date-empty'}`} />
                    </WorkflowCell>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <WorkflowCell saving={cellStatus[cellKey(inv.id, 'deadline_days')] === 'saving'} saved={cellStatus[cellKey(inv.id, 'deadline_days')] === 'saved'}>
                      <input type="number" min="0" value={hanDrafts[inv.id] ?? (inv.deadline_days ?? '')} disabled={cellStatus[cellKey(inv.id, 'deadline_days')] === 'saving'}
                        onChange={e => setHanDrafts(prev => ({ ...prev, [inv.id]: e.target.value }))}
                        onBlur={e => { if (e.target.value !== String(inv.deadline_days ?? '')) saveWorkflowHan(inv.id, e.target.value, inv.deadline_days); }}
                        className="w-16 border border-transparent hover:border-gray-300 focus:border-blue-300 rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-200" />
                    </WorkflowCell>
                    {overdue && <div className="text-red-600 text-xs font-semibold mt-0.5" title="Đã trễ hạn">⚠️ Quá hạn</div>}
                  </td>
                  <td className="px-5 py-3 text-right"><button onClick={() => handleDeleteOne(inv.id)} className="text-red-500 hover:text-red-700">Xóa</button></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
        </div>
        <Pagination page={page} maxPage={maxPage} onChange={loadPage} disabled={loading} />
      </div>
    </div>
  );
};

// Bọc 1 ô đang sửa (7 cột theo dõi hồ sơ): mờ đi + khóa tạm (pointer-events-none) trong lúc đang
// lưu, có chấm xoay nhỏ ở góc; lưu xong thì chớp nền xanh nhạt ~0.5s rồi trở lại bình thường.
// Định nghĩa ở module scope (không lồng trong InvoiceGoodsPage) để giữ nguyên identity component
// qua mỗi lần render — nếu định nghĩa lồng trong, React sẽ coi đây là component khác mỗi lần cha
// re-render (VD: mỗi lần gõ ký tự vào ô "Hạn"), unmount/remount input con, mất focus/con trỏ đang gõ.
function WorkflowCell({ saving, saved, children }) {
  return (
    <div className={`relative rounded transition-opacity ${saving ? 'opacity-50 pointer-events-none' : ''} ${saved ? 'bg-green-100' : ''}`}>
      {children}
      {saving && (
        <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
      )}
    </div>
  );
}

// Ô tiêu đề bảng có "tay kéo" ở mép phải để chỉnh độ rộng cột.
// - Rê chuột trên tay kéo: đổi độ rộng cột (xử lý ở onResize của trang).
// - Nhấp đúp trên tay kéo: trả cột về độ rộng mặc định (onReset).
// Cột có resizable=false (checkbox, nút Xóa) sẽ không hiện tay kéo.
function ResizableTh({ col, className = '', children, colWidths, onResize, onReset, sticky, left, dividerRight }) {
  const cfg = COLS.find(c => c.key === col);
  const canResize = cfg?.resizable;
  return (
    <th
      className={`relative select-none ${sticky ? 'sticky z-10 bg-gray-50' : ''} ${className}`}
      style={{ width: colWidths[col], ...(sticky ? { left } : {}) }}
    >
      {/* Không dùng "truncate" (cắt chữ + "...") nữa — cho tiêu đề tự xuống dòng khi cột hẹp,
          để luôn đọc được đủ chữ thay vì bị cắt mất. */}
      <div className="leading-tight whitespace-normal break-words">{children}</div>
      {/* Viền phân tách cột đóng băng: dùng 1 div nền màu thay vì border-right/box-shadow — 2 cái
          đó bị lỗi trình duyệt, không vẽ lại đúng sau khi cuộn ngang trên ô sticky (đã kiểm chứng
          thực tế: border biến mất ngay khi scrollLeft > 0, div nền màu thì không bị). */}
      {dividerRight && <div className="absolute top-0 right-0 h-full w-0.5 bg-gray-300" />}
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
