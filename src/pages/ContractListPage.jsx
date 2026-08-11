// File: src/pages/ContractListPage.jsx
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Badge } from '../components/Badge';
import { fmtNum } from '../helpers';
import { api } from '../lib/api';
import { BulkContractViewer } from './BulkContractViewer';
import { SaleSearchDropdown } from '../components/SaleSearchDropdown';
import { Pagination } from '../components/Pagination';

const FEE_TYPES = ['DDH', 'BBBG', 'DDH_VC', 'BBBG_VC', 'DDH_UT', 'BBBG_UT'];
const INVOICE_NO_TYPES = ['DDH', 'BBBG']; // chỉ loại Mua bán mới có tính năng chọn số hóa đơn có sẵn
const PAGE_SIZE = 30;

// Tìm kiếm/lọc/phân trang ngay ở server qua RPC list_contracts_paged — không còn tải hết hợp đồng
// của 1 loại về trình duyệt rồi mới lọc/phân trang như trước (mirror đúng khuôn mẫu đã dùng cho
// InvoiceGoodsPage.jsx). refreshVersion: App.jsx tăng số này sau mỗi lần Xóa/Sửa/Giao sale (kể cả từ
// ContractViewer) để danh sách tự tải lại đúng trang đang xem, không cần F5.
export const ContractListPage = ({ type, refreshVersion, customers, sellers, saleMap = {}, saleProfiles = [], setPage, setViewContract, onDelete, onDeleteMany, onAssign, onEdit }) => {
  const [assigningId, setAssigningId] = useState(null); // contractId đang được giao
  const showInvoiceNo = INVOICE_NO_TYPES.includes(type);
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
    } catch (e) {
      console.error('Không tải được danh sách hợp đồng:', e.message);
    } finally {
      if (myRequestId === requestIdRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, search, sellerFilter, fromDate, toDate]);

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
        {rows.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            {loading ? '⏳ Đang tải...' : hasFilter ? `Không tìm thấy ${labels[type]} phù hợp với bộ lọc` : `Chưa có ${labels[type]} nào`}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-gray-500 text-xs uppercase">
              <th className="px-4 py-3 w-8">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="cursor-pointer" />
              </th>
              <th className="text-left px-5 py-3">Số hợp đồng</th>
              <th className="text-left px-5 py-3">Khách hàng</th>
              <th className="text-left px-5 py-3">Bên bán</th>
              {showInvoiceNo && <th className="text-left px-5 py-3">Số hóa đơn</th>}
              <th className="text-left px-5 py-3">Ngày</th>
              {showTotal && <th className="text-left px-5 py-3">Tổng tiền</th>}
              <th className="text-left px-5 py-3">Sale</th>
              <th className="text-left px-5 py-3">Phòng ban</th>
              <th className="text-left px-5 py-3">Trạng thái</th>
              <th className="px-5 py-3"></th>
            </tr></thead>
            <tbody>
              {rows.map(c => {
                const total = c.total;
                return (
                  <tr key={c._dbId || c.contractId} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selectedIds.has(c.contractId)} onChange={() => toggleOne(c.contractId)} className="cursor-pointer" />
                    </td>
                    <td className="px-5 py-3 font-mono font-bold text-blue-700">{c.contractId}</td>
                    <td className="px-5 py-3 text-gray-700">{customerLabel(c)}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{sellerLabel(c)}</td>
                    {showInvoiceNo && <td className="px-5 py-3 font-mono text-gray-500 text-xs">{c.invoiceNo || '–'}</td>}
                    <td className="px-5 py-3 text-gray-500">{c.date}</td>
                    {showTotal && <td className="px-5 py-3 text-gray-700 font-medium">{total ? fmtNum(total) + ' đ' : '–'}</td>}
                    <td className="px-5 py-3 text-gray-600 text-xs">
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
                    <td className="px-5 py-3 text-gray-500 text-xs">{(saleMap[c._createdBy] || saleMap[c._maSale])?.deptName || '–'}</td>
                    <td className="px-5 py-3"><Badge color={c.status === 'Hoàn thành' ? 'green' : 'blue'}>{c.status}</Badge></td>
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
