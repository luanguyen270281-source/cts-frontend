// File: src/pages/ContractListPage.jsx
import { useState, useMemo, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import * as XLSX from 'xlsx';
import { Badge } from '../components/Badge';
import { fmtNum } from '../helpers';
import { api } from '../lib/api';
import { BulkContractViewer } from './BulkContractViewer';
import { SaleSearchDropdown } from '../components/SaleSearchDropdown';
import { Pagination } from '../components/Pagination';

const FEE_TYPES = ['DDH', 'BBBG', 'DDH_VC', 'BBBG_VC', 'DDH_UT', 'BBBG_UT'];
const INVOICE_NO_TYPES = ['DDH', 'BBBG']; // chỉ loại Mua bán mới có tính năng chọn số hóa đơn có sẵn
const HDNT_TYPES = ['HDNT', 'HDNT_VC', 'HDNT_UT']; // chỉ 3 loại HĐ Nguyên Tắc mới có cột "Kế toán nhận Hợp đồng"
const PAGE_SIZE = 30;

// Tìm kiếm/lọc/phân trang ngay ở server qua RPC list_contracts_paged — không còn tải hết hợp đồng
// của 1 loại về trình duyệt rồi mới lọc/phân trang như trước (mirror đúng khuôn mẫu đã dùng cho
// InvoiceGoodsPage.jsx). refreshVersion: App.jsx tăng số này sau mỗi lần Xóa/Sửa/Giao sale (kể cả từ
// ContractViewer) để danh sách tự tải lại đúng trang đang xem, không cần F5.
export const ContractListPage = ({ type, refreshVersion, customers, sellers, saleMap = {}, saleProfiles = [], setPage, setViewContract, onDelete, onDeleteMany, onAssign, onEdit }) => {
  const [assigningId, setAssigningId] = useState(null); // contractId đang được giao
  const showInvoiceNo = INVOICE_NO_TYPES.includes(type);
  const showAccountingReceived = HDNT_TYPES.includes(type);
  const [search, setSearch] = useState('');
  const [sellerFilter, setSellerFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkFullContracts, setBulkFullContracts] = useState([]);
  const [exporting, setExporting] = useState(false);

  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPageNum] = useState(1);
  const [loading, setLoading] = useState(true);
  const maxPage = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  // Đánh dấu request mới nhất — đổi bộ lọc/trang liên tiếp nhanh thì request cũ trả về trễ hơn bị bỏ qua.
  const requestIdRef = useRef(0);
  const isFirstRefresh = useRef(true);

  // ── Thanh cuộn ngang phụ ở TRÊN đầu bảng — y hệt cơ chế đã dùng cho InvoiceGoodsPage.jsx (xem
  // giải thích chi tiết ở đó): thanh trên KHÔNG PHẢI phần tử cuộn thật (không overflow-x-auto riêng)
  // mà chỉ là 1 track tĩnh + 1 "thumb" tự vẽ, đồng bộ 1 CHIỀU bằng cách đọc/ghi trực tiếp scrollLeft
  // của bảng thật — tránh lặp lại lỗi giật do 2 scrollbar thật đồng bộ qua lại (commit 22945f3).
  const topTrackRef = useRef(null);
  const topThumbRef = useRef(null);
  const tableScrollRef = useRef(null);
  const tableElRef = useRef(null);
  const [tableRenderWidth, setTableRenderWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  // Đóng băng (sticky) cột checkbox + "Số hợp đồng" khi cuộn ngang, để luôn biết đang xem hợp đồng
  // nào và vẫn chọn được dòng dù đã cuộn sang phải. Đo width thật của cột checkbox bằng
  // ResizeObserver (không đoán cứng theo class Tailwind) để cột "Số hợp đồng" luôn ghép khít ngay
  // sau nó, kể cả khi CSS/font thay đổi độ rộng thật của checkbox.
  const checkboxThRef = useRef(null);
  const [checkboxColWidth, setCheckboxColWidth] = useState(0);
  const contractIdLeft = checkboxColWidth;

  useLayoutEffect(() => {
    const tableEl = tableElRef.current;
    const containerEl = tableScrollRef.current;
    const checkboxEl = checkboxThRef.current;
    if (!tableEl || !containerEl || typeof ResizeObserver === 'undefined') return;
    const roTable = new ResizeObserver(([entry]) => setTableRenderWidth(entry.contentRect.width));
    const roContainer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    roTable.observe(tableEl);
    roContainer.observe(containerEl);
    let roCheckbox;
    if (checkboxEl) {
      roCheckbox = new ResizeObserver(([entry]) => setCheckboxColWidth(entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width));
      roCheckbox.observe(checkboxEl);
    }
    return () => { roTable.disconnect(); roContainer.disconnect(); roCheckbox?.disconnect(); };
  }, [rows.length]);

  // Chỉ hiện thanh cuộn giả ở trên khi THỰC SỰ cần cuộn ngang (bảng rộng hơn khung nhìn).
  const needsHScroll = containerWidth > 0 && tableRenderWidth > containerWidth + 1;
  const topThumbPct = tableRenderWidth > 0 ? Math.min(100, (containerWidth / tableRenderWidth) * 100) : 100;

  const updateTopThumb = () => {
    const track = topTrackRef.current;
    const thumb = topThumbRef.current;
    const table = tableScrollRef.current;
    if (!track || !thumb || !table) return;
    const maxThumbLeft = track.clientWidth - thumb.clientWidth;
    const maxScrollLeft = table.scrollWidth - table.clientWidth;
    const ratio = maxScrollLeft > 0 ? Math.min(1, Math.max(0, table.scrollLeft / maxScrollLeft)) : 0;
    thumb.style.transform = `translateX(${ratio * Math.max(0, maxThumbLeft)}px)`;
  };
  useLayoutEffect(() => { updateTopThumb(); });

  const startTopDrag = (e) => {
    e.preventDefault();
    const track = topTrackRef.current;
    const thumb = topThumbRef.current;
    const table = tableScrollRef.current;
    if (!track || !thumb || !table) return;
    const trackRect = track.getBoundingClientRect();
    const thumbWidth = thumb.clientWidth;
    const maxThumbLeft = trackRect.width - thumbWidth;
    const maxScrollLeft = table.scrollWidth - table.clientWidth;
    if (maxThumbLeft <= 0 || maxScrollLeft <= 0) return;

    const moveTo = (clientX) => {
      const x = clientX - trackRect.left - thumbWidth / 2;
      const clamped = Math.min(Math.max(x, 0), maxThumbLeft);
      table.scrollLeft = (clamped / maxThumbLeft) * maxScrollLeft;
    };
    moveTo(e.clientX);

    const onMove = (ev) => moveTo(ev.clientX);
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const labels = {
    HDNT: 'Hợp Đồng Nguyên Tắc', DDH: 'Đơn Đặt Hàng', BBBG: 'Biên Bản Bàn Giao',
    HDNT_VC: 'HĐ Nguyên Tắc (Vận chuyển)', DDH_VC: 'Đơn Đặt Dịch Vụ', BBBG_VC: 'Biên Bản Bàn Giao (Vận chuyển)',
    HDNT_UT: 'HĐ Nguyên Tắc (Ủy thác)', DDH_UT: 'Đơn Đặt Dịch Vụ Ủy Thác', BBBG_UT: 'Biên Bản Bàn Giao (Ủy thác)',
  };
  const createPages = {
    HDNT: 'create-hdnt', DDH: 'create-ddh', BBBG: 'create-bbbg',
    HDNT_VC: 'create-hdnt_vc', DDH_VC: 'create-ddh_vc', BBBG_VC: 'create-bbbg_vc',
    HDNT_UT: 'create-hdnt_ut', DDH_UT: 'create-ddh_ut', BBBG_UT: 'create-bbbg_ut',
  };
  const showTotal = FEE_TYPES.includes(type);

  const customerLabel = (c) => c.customerSnapshot?.companyName || customers[c.customerId]?.companyName || c.customerName || c.customerId;
  const sellerLabel = (c) => c.sellerSnapshot?.companyName || sellers[c.sellerId]?.companyName || c.sellerId || '';
  // Chỉ lấy phần tên viết tắt của ngân hàng (trước dấu ":") — dữ liệu cũ có ô "Ngân hàng" bị gõ nhầm
  // thành "Techcombank: Ngân hàng TMCP Kỹ Thương Việt Nam" thay vì chỉ tên ngắn gọn.
  const sellerBankLabel = (c) => {
    const s = c.sellerSnapshot || sellers[c.sellerId] || {};
    if (!s.bankAccount) return '';
    const shortBank = s.bankName ? s.bankName.split(':')[0].trim() : '';
    return shortBank ? `${s.bankAccount} (${shortBank})` : s.bankAccount;
  };

  const sellerOptions = useMemo(
    () => Object.entries(sellers).map(([id, s]) => ({ id, name: s.companyName })).sort((a, b) => a.name.localeCompare(b.name)),
    [sellers]
  );

  // RPC trả về { id, contract_id, ma_sale, created_by, data:{...}, total }. Trải "data" ra thành các
  // field cấp cao nhất (contractId, date, type, status...) — giữ đúng hình dạng object như trước đây,
  // để phần JSX/hiển thị bên dưới không phải đổi gì thêm.
  const mapRow = (r) => ({ ...r.data, _dbId: r.id, _maSale: r.ma_sale, _createdBy: r.created_by, total: r.total });

  const loadPage = useCallback(async (pageToLoad) => {
    const myRequestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const { rows: newRows, totalCount: tc } = await api.listContractsPaged({
        type, search, seller: sellerFilter, dateFrom: fromDate, dateTo: toDate,
        limit: PAGE_SIZE, offset: (pageToLoad - 1) * PAGE_SIZE,
      });
      if (myRequestId !== requestIdRef.current) return; // có request mới hơn chạy sau, bỏ kết quả này
      if (newRows.length === 0 && pageToLoad > 1 && tc > 0) {
        loadPage(pageToLoad - 1); // trang hiện tại vừa bị xóa hết dòng cuối → lùi về trang trước
        return;
      }
      setRows(newRows.map(mapRow));
      setTotalCount(tc);
      setPageNum(pageToLoad);
      // "Kế toán nhận Hợp đồng" nằm ở cột thật trên bảng contracts, RPC không trả về — lấy riêng
      // cho các dòng vừa tải, chỉ khi đang ở 1 trong 3 màn HĐ Nguyên Tắc.
      if (showAccountingReceived) {
        const ids = newRows.map(r => r.id).filter(Boolean);
        if (ids.length > 0) {
          const accMap = await api.getContractsAccountingMap(ids).catch(() => ({}));
          if (myRequestId === requestIdRef.current) {
            setRows(prev => prev.map(r => ({ ...r, accounting_received: !!accMap[r._dbId] })));
          }
        }
      }
    } catch (e) {
      console.error('Không tải được danh sách hợp đồng:', e.message);
    } finally {
      if (myRequestId === requestIdRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, search, sellerFilter, fromDate, toDate, showAccountingReceived]);

  // Đổi loại hợp đồng (chuyển trang HĐNT/ĐĐH/BBBG...) → xóa ngay dữ liệu cũ, tránh thoáng hiện nhầm
  // dữ liệu loại cũ dưới tiêu đề loại mới trong lúc chờ tải xong loại mới.
  useEffect(() => { setRows([]); setTotalCount(0); }, [type]);

  // Đổi loại hợp đồng (chuyển trang HĐNT/ĐĐH/BBBG...) hoặc bộ lọc/tìm kiếm → quay về trang 1 (debounce
  // 300ms khi gõ tìm kiếm, đổi loại/dropdown/ngày thì tải ngay). "type" PHẢI có trong deps — component
  // này dùng chung 1 instance cho cả 9 trang danh sách (không remount khi đổi trang), thiếu "type" ở đây
  // từng khiến chuyển trang không tải lại, hiện nhầm dữ liệu của loại cũ dưới tiêu đề loại mới.
  useEffect(() => {
    const t = setTimeout(() => { loadPage(1); setSelectedIds(new Set()); }, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, search, sellerFilter, fromDate, toDate]);

  // Có thay đổi hợp đồng ở nơi khác (Xóa/Sửa/Giao sale — kể cả từ màn Xem chi tiết) → tải lại ĐÚNG
  // trang đang xem, không quay về trang 1 (khỏi giật màn hình).
  useEffect(() => {
    if (isFirstRefresh.current) { isFirstRefresh.current = false; return; }
    loadPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshVersion]);

  const toggleOne = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Tích "Kế toán nhận Hợp đồng" — cập nhật ngay trên giao diện rồi lưu xuống Supabase, lỗi thì hoàn lại.
  const toggleAccountingReceived = async (dbId, current) => {
    const next = !current;
    setRows(prev => prev.map(r => r._dbId === dbId ? { ...r, accounting_received: next } : r));
    try {
      await api.updateContractAccountingReceived(dbId, next);
    } catch (e) {
      setRows(prev => prev.map(r => r._dbId === dbId ? { ...r, accounting_received: current } : r));
      alert('Không lưu được: ' + e.message);
    }
  };

  // Chỉ áp dụng "chọn tất cả" cho các dòng đang tải sẵn (trang hiện tại), tránh chọn nhầm hàng nghìn
  // dòng chưa tải (giống hệt cách InvoiceGoodsPage đã làm).
  const visibleIds = rows.map(c => c.contractId);
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

  const selectedContracts = rows.filter(c => selectedIds.has(c.contractId));

  // "In / Tải gộp" cần đủ dữ liệu (kể cả goods) cho từng hợp đồng được chọn — danh sách chỉ giữ bản
  // nhẹ (không có goods) từ sau khi list_contracts_slim/list_contracts_paged bỏ goods ra khỏi payload.
  const openBulkView = async () => {
    setBulkLoading(true);
    try {
      const fulls = await Promise.all(selectedContracts.map(async (c) => {
        if (!c._dbId) return c;
        try {
          const res = await api.getContractFull(c._dbId);
          return { ...res.data, _dbId: res.id, _maSale: res.ma_sale, _createdBy: res.created_by };
        } catch { return c; } // dùng tạm bản nhẹ nếu 1 hợp đồng nào đó lỗi
      }));
      setBulkFullContracts(fulls);
      setBulkOpen(true);
    } finally {
      setBulkLoading(false);
    }
  };

  const handleDeleteOne = async (c) => { await onDelete(c); };
  const handleDeleteMany = async () => {
    const ok = await onDeleteMany(selectedContracts);
    if (ok) setSelectedIds(new Set());
  };

  // Xuất Excel toàn bộ hợp đồng khớp bộ lọc hiện tại (không chỉ trang đang xem) — tự lặp lấy hết
  // các trang, chia lô 1000 dòng/lần, giống hệt cách InvoiceGoodsPage đã làm.
  const exportToExcel = async () => {
    setExporting(true);
    try {
      let all = [];
      let offset = 0;
      const CHUNK = 1000;
      while (true) {
        const { rows: chunkRows } = await api.listContractsPaged({
          type, search, seller: sellerFilter, dateFrom: fromDate, dateTo: toDate,
          limit: CHUNK, offset,
        });
        all = all.concat(chunkRows.map(mapRow));
        if (chunkRows.length < CHUNK) break;
        offset += CHUNK;
        if (offset > 100000) break; // chặn an toàn
      }
      if (all.length === 0) { alert('Không có hợp đồng nào để xuất.'); return; }
      const data = all.map(c => {
        const sale = saleMap[c._createdBy] || saleMap[c._maSale];
        const row = {
          'Số hợp đồng': c.contractId,
          'Khách hàng': customerLabel(c),
          'Bên bán': sellerLabel(c),
          'Ngày': c.date || '',
        };
        row['STK Bên bán'] = sellerBankLabel(c);
        if (showInvoiceNo) row['Số hóa đơn'] = c.invoiceNo || '';
        if (showTotal) row['Tổng tiền'] = c.total || 0;
        row['Sale'] = sale?.name || c._maSale || '';
        row['Phòng ban'] = sale?.deptName || '';
        row['Trạng thái'] = c.status || '';
        return row;
      });
      const ws = XLSX.utils.json_to_sheet(data);
      ws['!cols'] = Object.keys(data[0] || {}).map(() => ({ wch: 22 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, labels[type].slice(0, 31));
      const today = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `${labels[type].replace(/\s+/g, '_')}_${today}.xlsx`);
    } catch (e) {
      alert('Không xuất được Excel: ' + e.message);
    } finally {
      setExporting(false);
    }
  };

  const resetFilters = () => { setSearch(''); setSellerFilter(''); setFromDate(''); setToDate(''); setSelectedIds(new Set()); };
  const hasFilter = search || sellerFilter || fromDate || toDate;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">{labels[type]}</h1>
        <div className="flex items-center gap-2">
          <button onClick={exportToExcel} disabled={exporting || totalCount === 0}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 text-sm font-medium shadow-sm disabled:opacity-50">
            {exporting ? '⏳ Đang xuất...' : '📤 Xuất Excel'}
          </button>
          <button onClick={() => setPage(createPages[type])} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium shadow">+ Tạo mới</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Tìm theo số hợp đồng hoặc tên khách hàng..."
          className="flex-1 min-w-48 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        <select value={sellerFilter} onChange={e => setSellerFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white min-w-[160px] focus:outline-none focus:ring-2 focus:ring-blue-300">
          <option value="">Tất cả bên bán</option>
          {sellerOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <span>Từ</span>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          <span>đến</span>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        {hasFilter && (
          <button onClick={resetFilters} className="text-sm text-gray-500 hover:text-gray-700 px-2">✕ Xóa lọc</button>
        )}
      </div>

      {totalCount > 0 && (
        <div className="text-xs text-gray-400 mb-2">Trang {page}/{maxPage} — tổng cộng {totalCount} {labels[type]}</div>
      )}

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-3">
          <div className="text-sm text-blue-800 font-medium">✓ Đã chọn {selectedIds.size} hợp đồng</div>
          <div className="flex gap-2">
            <button onClick={openBulkView} disabled={bulkLoading} className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {bulkLoading ? '⏳ Đang tải...' : '🖨️ In / Tải gộp'}
            </button>
            <button onClick={handleDeleteMany} className="bg-red-50 text-red-600 border border-red-200 px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-red-100">
              🗑️ Xóa gộp
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="text-sm text-blue-700 hover:underline px-2">Bỏ chọn</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {rows.length > 0 && needsHScroll && (
          <div
            ref={topTrackRef}
            onMouseDown={startTopDrag}
            className="relative border-b border-gray-200 bg-gray-100 cursor-pointer"
            style={{ height: 14 }}
          >
            <div
              ref={topThumbRef}
              className="absolute top-0 left-0 h-full rounded-lg hover:opacity-80"
              style={{ width: `${topThumbPct}%`, background: '#93c5fd', border: '3px solid #f3f4f6', boxSizing: 'border-box' }}
            />
          </div>
        )}
        {rows.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            {loading ? '⏳ Đang tải...' : hasFilter ? `Không tìm thấy ${labels[type]} phù hợp với bộ lọc` : `Chưa có ${labels[type]} nào`}
          </div>
        ) : (
          // Bảng đã lên tới 12 cột (thêm STK) — dễ tràn khỏi màn hình hẹp. Bọc trong 1 khung
          // overflow-x-auto (chỉ 1 scrollbar thật duy nhất, không đồng bộ 2 thanh nên không bị giật
          // như InvoiceGoodsPage từng gặp) + whitespace-nowrap ở các cột ngắn để không bị vỡ dòng
          // lung tung khi cuộn ngang. Thanh cuộn giả ở trên (khối trên) chỉ đọc/ghi scrollLeft của
          // khung này, không phải scrollbar thật thứ 2.
          <div ref={tableScrollRef} onScroll={updateTopThumb} className="overflow-x-auto wide-table-scroll">
          <table ref={tableElRef} className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-gray-500 text-xs uppercase">
              <th ref={checkboxThRef} className="sticky left-0 z-10 bg-gray-50 px-4 py-3 w-8">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="cursor-pointer" />
              </th>
              <th className="sticky z-10 bg-gray-50 text-left px-5 py-3 whitespace-nowrap relative" style={{ left: contractIdLeft }}>
                Số hợp đồng
                {needsHScroll && <div className="absolute top-0 right-0 h-full w-0.5 bg-gray-300" />}
              </th>
              <th className="text-left px-5 py-3 whitespace-nowrap">Khách hàng</th>
              <th className="text-left px-5 py-3 whitespace-nowrap">Bên bán</th>
              <th className="text-left px-5 py-3 whitespace-nowrap">STK</th>
              {showInvoiceNo && <th className="text-left px-5 py-3 whitespace-nowrap">Số hóa đơn</th>}
              <th className="text-left px-5 py-3 whitespace-nowrap">Ngày</th>
              {showTotal && <th className="text-left px-5 py-3 whitespace-nowrap">Tổng tiền</th>}
              <th className="text-left px-5 py-3 whitespace-nowrap">Sale</th>
              <th className="text-left px-5 py-3 whitespace-nowrap">Phòng ban</th>
              <th className="text-left px-5 py-3 whitespace-nowrap">Trạng thái</th>
              {showAccountingReceived && (
                <th className="text-center px-3 py-3 w-28 whitespace-nowrap">Kế toán nhận<br />Hợp đồng</th>
              )}
              <th className="px-5 py-3"></th>
            </tr></thead>
            <tbody>
              {rows.map(c => {
                const total = c.total;
                return (
                  <tr key={c._dbId || c.contractId} className="group/row border-t border-gray-100 hover:bg-gray-50">
                    <td className="sticky left-0 z-10 bg-white group-hover/row:bg-gray-50 px-4 py-3">
                      <input type="checkbox" checked={selectedIds.has(c.contractId)} onChange={() => toggleOne(c.contractId)} className="cursor-pointer" />
                    </td>
                    <td className="sticky z-10 bg-white group-hover/row:bg-gray-50 px-5 py-3 font-mono font-bold whitespace-nowrap relative" style={{ left: contractIdLeft }}>
                      <button onClick={() => setViewContract(c)} className="text-blue-700 hover:text-blue-900 hover:underline" title="Xem chi tiết">
                        {c.contractId}
                      </button>
                      {/* Div nền thay vì border-right — border trên ô sticky bị lỗi trình duyệt, mất khi cuộn ngang (đã gặp ở InvoiceGoodsPage). */}
                      {needsHScroll && <div className="absolute top-0 right-0 h-full w-0.5 bg-gray-300" />}
                    </td>
                    <td className="px-5 py-3 text-gray-700 whitespace-nowrap">{customerLabel(c)}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">{sellerLabel(c)}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs font-mono whitespace-nowrap">{sellerBankLabel(c) || '–'}</td>
                    {showInvoiceNo && <td className="px-5 py-3 font-mono text-gray-500 text-xs whitespace-nowrap">{c.invoiceNo || '–'}</td>}
                    <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{c.date}</td>
                    {showTotal && <td className="px-5 py-3 text-gray-700 font-medium whitespace-nowrap">{total ? fmtNum(total) + ' đ' : '–'}</td>}
                    <td className="px-5 py-3 text-gray-600 text-xs whitespace-nowrap">
                      {saleProfiles.length > 0 ? (
                        assigningId === c.contractId ? (
                          <SaleSearchDropdown
                            saleProfiles={saleProfiles}
                            value={c._maSale || c._createdBy || ''}
                            onChange={async uuid => {
                              if (uuid) { try { await onAssign(c, uuid); } catch {} }
                              setAssigningId(null);
                            }}
                            placeholder="Chọn sale..."
                          />
                        ) : (
                          <button onClick={() => setAssigningId(c.contractId)}
                            className="hover:text-blue-600 hover:underline text-left w-full"
                            title="Bấm để giao cho sale khác">
                            {(saleMap[c._createdBy] || saleMap[c._maSale])?.name || c._maSale || <span className="text-gray-300 italic">Chưa gán</span>}
                          </button>
                        )
                      ) : (
                        (saleMap[c._createdBy] || saleMap[c._maSale])?.name || c._maSale || '–'
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">{(saleMap[c._createdBy] || saleMap[c._maSale])?.deptName || '–'}</td>
                    <td className="px-5 py-3 whitespace-nowrap"><Badge color={c.status === 'Hoàn thành' ? 'green' : 'blue'}>{c.status}</Badge></td>
                    {showAccountingReceived && (
                      <td className="px-5 py-3 text-center">
                        <input type="checkbox" checked={!!c.accounting_received}
                          onChange={() => toggleAccountingReceived(c._dbId, !!c.accounting_received)}
                          className="cursor-pointer w-4 h-4 accent-green-600" title="Tích khi Kế toán đã nhận hợp đồng" />
                      </td>
                    )}
                    <td className="px-5 py-3 whitespace-nowrap text-right">
                      <button onClick={() => setViewContract(c)} className="text-blue-600 hover:text-blue-800 font-medium text-sm mr-3">Xem →</button>
                      <button onClick={() => onEdit(c)} className="text-yellow-600 hover:text-yellow-800 font-medium text-sm mr-3">Sửa</button>
                      <button onClick={() => handleDeleteOne(c)} className="text-red-500 hover:text-red-700 font-medium text-sm">Xóa</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
        <Pagination page={page} maxPage={maxPage} onChange={loadPage} disabled={loading} />
      </div>

      {bulkOpen && (
        <BulkContractViewer
          contracts={bulkFullContracts}
          sellers={sellers}
          customers={customers}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </div>
  );
};
