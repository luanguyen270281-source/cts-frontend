// File: src/pages/ContractListPage.jsx
import { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Badge } from '../components/Badge';
import { calcTotals, fmtNum } from '../helpers';
import { BulkContractViewer } from './BulkContractViewer';
import { SaleSearchDropdown } from '../components/SaleSearchDropdown';
import { Pagination } from '../components/Pagination';
import { useResizableColumns, ResizableColgroup, ResizableTh } from '../components/useResizableColumns';

const FEE_TYPES = ['DDH', 'BBBG', 'DDH_VC', 'BBBG_VC', 'DDH_UT', 'BBBG_UT'];
const INVOICE_NO_TYPES = ['DDH', 'BBBG']; // chỉ loại Mua bán mới có tính năng chọn số hóa đơn có sẵn
const PAGE_SIZE = 30;

export const ContractListPage = ({ type, contracts, customers, sellers, saleMap = {}, saleProfiles = [], setPage, setViewContract, onDelete, onDeleteMany, onAssign, onEdit }) => {
  const [assigningId, setAssigningId] = useState(null); // contractId đang được giao
  const showInvoiceNo = INVOICE_NO_TYPES.includes(type);
  const [search, setSearch] = useState('');
  const [sellerFilter, setSellerFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [pageNum, setPageNum] = useState(1);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

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

  // Cấu hình cột cho bảng — có cột động (Số hóa đơn / Tổng tiền) tùy loại hợp đồng,
  // nên danh sách cột dựng lại theo showInvoiceNo/showTotal để colgroup luôn khớp.
  const columns = useMemo(() => {
    const c = [
      { key: 'sel',      width: 44,  min: 44,  resizable: false },
      { key: 'contract', width: 150, min: 90,  resizable: true  },
      { key: 'customer', width: 240, min: 120, resizable: true  },
      { key: 'seller',   width: 220, min: 120, resizable: true  },
    ];
    if (showInvoiceNo) c.push({ key: 'invoice', width: 130, min: 80, resizable: true });
    c.push({ key: 'date', width: 110, min: 70, resizable: true });
    if (showTotal) c.push({ key: 'total', width: 140, min: 90, resizable: true });
    c.push(
      { key: 'sale',   width: 160, min: 90,  resizable: true  },
      { key: 'dept',   width: 150, min: 90,  resizable: true  },
      { key: 'status', width: 130, min: 90,  resizable: true  },
      { key: 'action', width: 70,  min: 60,  resizable: false },
    );
    return c;
  }, [showInvoiceNo, showTotal]);
  const rt = useResizableColumns(columns, 'contractList.colWidths');

  const customerLabel = (c) => c.customerSnapshot?.companyName || customers[c.customerId]?.companyName || c.customerName || c.customerId;
  const sellerLabel = (c) => c.sellerSnapshot?.companyName || sellers[c.sellerId]?.companyName || c.sellerId || '';

  const allOfType = useMemo(
    () => Object.values(contracts).filter(c => c.type === type).sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [contracts, type]
  );

  const sellerOptions = useMemo(
    () => Object.entries(sellers).map(([id, s]) => ({ id, name: s.companyName })).sort((a, b) => a.name.localeCompare(b.name)),
    [sellers]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allOfType.filter(c => {
      const matchSearch = !q || c.contractId.toLowerCase().includes(q) || customerLabel(c).toLowerCase().includes(q);
      const matchSeller = !sellerFilter || c.sellerId === sellerFilter;
      const matchFrom = !fromDate || (c.date || '') >= fromDate;
      const matchTo = !toDate || (c.date || '') <= toDate;
      return matchSearch && matchSeller && matchFrom && matchTo;
    });
  }, [allOfType, search, sellerFilter, fromDate, toDate, customers]);

  const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePageNum = Math.min(pageNum, maxPage);
  const list = filtered.slice((safePageNum - 1) * PAGE_SIZE, safePageNum * PAGE_SIZE);
  const hasFilter = search || sellerFilter || fromDate || toDate;

  const resetFilters = () => { setSearch(''); setSellerFilter(''); setFromDate(''); setToDate(''); setPageNum(1); setSelectedIds(new Set()); };

  const toggleOne = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const visibleIds = list.map(c => c.contractId);
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

  const selectedContracts = allOfType.filter(c => selectedIds.has(c.contractId));

  const exportToExcel = () => {
    const data = filtered.map(c => {
      const sale = saleMap[c._createdBy] || saleMap[c._maSale];
      const row = {
        'Số hợp đồng': c.contractId,
        'Khách hàng': customerLabel(c),
        'Bên bán': sellerLabel(c),
        'Ngày': c.date || '',
      };
      if (showInvoiceNo) row['Số hóa đơn'] = c.invoiceNo || '';
      if (showTotal) row['Tổng tiền'] = calcTotals(c.goods).total || 0;
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
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">{labels[type]}</h1>
        <div className="flex items-center gap-2">
          <button onClick={exportToExcel} disabled={filtered.length === 0}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 text-sm font-medium shadow-sm disabled:opacity-50">📤 Xuất Excel</button>
          <button onClick={() => setPage(createPages[type])} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium shadow">+ Tạo mới</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input value={search} onChange={e => { setSearch(e.target.value); setPageNum(1); }}
          placeholder="🔍 Tìm theo số hợp đồng hoặc tên khách hàng..."
          className="flex-1 min-w-48 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        <select value={sellerFilter} onChange={e => { setSellerFilter(e.target.value); setPageNum(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white min-w-[160px] focus:outline-none focus:ring-2 focus:ring-blue-300">
          <option value="">Tất cả bên bán</option>
          {sellerOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <span>Từ</span>
          <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPageNum(1); }}
            className="border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          <span>đến</span>
          <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPageNum(1); }}
            className="border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        {hasFilter && (
          <button onClick={resetFilters} className="text-sm text-gray-500 hover:text-gray-700 px-2">✕ Xóa lọc</button>
        )}
      </div>

      {hasFilter && (
        <div className="text-xs text-gray-400 mb-2">Tìm thấy {filtered.length} / {allOfType.length} {labels[type]}{maxPage > 1 ? ` — Trang ${safePageNum}/${maxPage}` : ''}</div>
      )}

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-3">
          <div className="text-sm text-blue-800 font-medium">✓ Đã chọn {selectedIds.size} hợp đồng</div>
          <div className="flex gap-2">
            <button onClick={() => setBulkOpen(true)} className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">
              🖨️ In / Tải gộp
            </button>
            <button
              onClick={async () => { const ok = await onDeleteMany(Array.from(selectedIds)); if (ok) setSelectedIds(new Set()); }}
              className="bg-red-50 text-red-600 border border-red-200 px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-red-100"
            >
              🗑️ Xóa gộp
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="text-sm text-blue-700 hover:underline px-2">Bỏ chọn</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {allOfType.length === 0 ? (
          <div className="p-12 text-center text-gray-400">Chưa có {labels[type]} nào</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-400">Không tìm thấy {labels[type]} phù hợp với bộ lọc</div>
        ) : (
          <table className="text-sm table-fixed" style={{ width: rt.totalWidth }}>
            <ResizableColgroup rt={rt} />
            <thead><tr className="bg-gray-50 text-gray-500 text-xs uppercase">
              <ResizableTh rt={rt} col="sel" className="px-4 py-3">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="cursor-pointer" />
              </ResizableTh>
              <ResizableTh rt={rt} col="contract" className="text-left px-5 py-3">Số hợp đồng</ResizableTh>
              <ResizableTh rt={rt} col="customer" className="text-left px-5 py-3">Khách hàng</ResizableTh>
              <ResizableTh rt={rt} col="seller" className="text-left px-5 py-3">Bên bán</ResizableTh>
              {showInvoiceNo && <ResizableTh rt={rt} col="invoice" className="text-left px-5 py-3">Số hóa đơn</ResizableTh>}
              <ResizableTh rt={rt} col="date" className="text-left px-5 py-3">Ngày</ResizableTh>
              {showTotal && <ResizableTh rt={rt} col="total" className="text-left px-5 py-3">Tổng tiền</ResizableTh>}
              <ResizableTh rt={rt} col="sale" className="text-left px-5 py-3">Sale</ResizableTh>
              <ResizableTh rt={rt} col="dept" className="text-left px-5 py-3">Phòng ban</ResizableTh>
              <ResizableTh rt={rt} col="status" className="text-left px-5 py-3">Trạng thái</ResizableTh>
              <ResizableTh rt={rt} col="action" className="px-5 py-3"></ResizableTh>
            </tr></thead>
            <tbody>
              {list.map(c => {
                const total = calcTotals(c.goods).total;
                return (
                  <tr key={c.contractId} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selectedIds.has(c.contractId)} onChange={() => toggleOne(c.contractId)} className="cursor-pointer" />
                    </td>
                    <td className="px-5 py-3 font-mono font-bold text-blue-700 truncate">{c.contractId}</td>
                    <td className="px-5 py-3 text-gray-700 truncate" title={customerLabel(c)}>{customerLabel(c)}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs truncate" title={sellerLabel(c)}>{sellerLabel(c)}</td>
                    {showInvoiceNo && <td className="px-5 py-3 font-mono text-gray-500 text-xs truncate">{c.invoiceNo || '–'}</td>}
                    <td className="px-5 py-3 text-gray-500 truncate">{c.date}</td>
                    {showTotal && <td className="px-5 py-3 text-gray-700 font-medium truncate">{total ? fmtNum(total) + ' đ' : '–'}</td>}
                    <td className="px-5 py-3 text-gray-600 text-xs">
                      {saleProfiles.length > 0 ? (
                        assigningId === c.contractId ? (
                          <SaleSearchDropdown
                            saleProfiles={saleProfiles}
                            value={c._maSale || c._createdBy || ''}
                            onChange={async uuid => {
                              if (uuid) { try { await onAssign(c.contractId, uuid); } catch {} }
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
                      <button onClick={() => onDelete(c.contractId)} className="text-red-500 hover:text-red-700 font-medium text-sm">Xóa</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <Pagination page={safePageNum} maxPage={maxPage} onChange={setPageNum} />
      </div>

      {bulkOpen && (
        <BulkContractViewer
          contracts={selectedContracts}
          sellers={sellers}
          customers={customers}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </div>
  );
};
