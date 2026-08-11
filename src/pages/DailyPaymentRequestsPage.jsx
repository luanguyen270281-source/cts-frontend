// File: src/pages/DailyPaymentRequestsPage.jsx
// Nhật ký Đề Nghị Thanh Toán — dành cho admin xem MỖI NGÀY có những đề nghị thanh toán nào,
// gộp chung tất cả khách hàng lại, không phải xem từng khách một như "Tổng hợp công nợ".
import { useState, useMemo } from 'react';
import { fmtNum } from '../helpers';

const fmtDateVN = (d) => {
  if (!d) return '—';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
};

export const DailyPaymentRequestsPage = ({ batches = [], customers = {}, sellers = {}, saleProfiles = [], onOpenPaymentRequest }) => {
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState(''); // '' = tất cả ngày

  const saleInfoByUuid = useMemo(() => Object.fromEntries(saleProfiles.map(p => [p.uuid, { code: p.ma_sale, name: p.name }])), [saleProfiles]);
  const customerLabel = (b) => {
    const c = customers[b.customer_id];
    if (!c) return b.customer_id || '—';
    const branch = b.branch_tax_code ? (c.branches || []).find(x => x.id === b.branch_tax_code) : null;
    return branch?.companyName || c.companyName || b.customer_id;
  };

  // Gộp các dòng theo (ngày làm đề nghị + Số đề nghị TT + khách hàng) — 1 đề nghị có thể có nhiều dòng/lô.
  const groups = useMemo(() => {
    const map = {};
    batches.forEach(b => {
      if (!b.payment_request_no) return; // chỉ tính các dòng thực sự thuộc 1 Đề Nghị Thanh Toán
      const date = b.order_date || '';
      const key = `${date}__${b.payment_request_no}__${b.customer_id}`;
      if (!map[key]) {
        map[key] = {
          date, requestNo: b.payment_request_no, customerId: b.customer_id,
          sellerNames: new Set(), lineCount: 0, totalCtsPhaiThu: 0, totalDaThuKhach: 0,
          saleCode: saleInfoByUuid[b.created_by]?.code || '', saleName: saleInfoByUuid[b.created_by]?.name || '',
          batchIds: [],
        };
      }
      const g = map[key];
      g.lineCount += 1;
      g.totalCtsPhaiThu += Number(b.deposit_vnd) || 0;
      g.totalDaThuKhach += Number(b.customer_paid_total) || 0;
      g.batchIds.push(b.id);
      if (sellers[b.seller_id]) g.sellerNames.add(sellers[b.seller_id].companyName);
      g.customerDisplay = customerLabel(b);
    });
    return Object.values(map).sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.requestNo).localeCompare(String(a.requestNo)));
  }, [batches, customers, sellers, saleInfoByUuid]);

  const filtered = groups.filter(g => {
    const s = search.trim().toLowerCase();
    const matchSearch = !s || g.customerId.toLowerCase().includes(s) || (g.customerDisplay || '').toLowerCase().includes(s) || String(g.requestNo).toLowerCase().includes(s);
    const matchDate = !dateFilter || g.date === dateFilter;
    return matchSearch && matchDate;
  });

  // Danh sách các ngày có dữ liệu, để chọn nhanh
  const availableDates = useMemo(() => [...new Set(groups.map(g => g.date).filter(Boolean))].sort((a, b) => b.localeCompare(a)), [groups]);

  let lastDate = null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-800">📅 Tổng hợp chung</h1>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Tìm theo mã khách, tên khách, số đề nghị..."
          className="flex-1 min-w-[240px] border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        <select value={dateFilter} onChange={e => setDateFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm">
          <option value="">-- Tất cả các ngày --</option>
          {availableDates.map(d => <option key={d} value={d}>{fmtDateVN(d)}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-400">Chưa có Đề Nghị Thanh Toán nào.</div>
        ) : (
          <table className="w-full text-sm min-w-[1000px]">
            <thead><tr className="bg-gray-50 text-gray-500 text-xs uppercase">
              <th className="text-left px-4 py-3 font-semibold">Ngày</th>
              <th className="text-left px-4 py-3 font-semibold">Số ĐN TT</th>
              <th className="text-left px-4 py-3 font-semibold">Mã KH</th>
              <th className="text-left px-4 py-3 font-semibold">Tên xuất hóa đơn</th>
              <th className="text-left px-4 py-3 font-semibold">Cty thu tiền</th>
              <th className="text-center px-4 py-3 font-semibold">Số lô</th>
              <th className="text-right px-4 py-3 font-semibold">CTS phải thu</th>
              <th className="text-right px-4 py-3 font-semibold">Đã thu khách</th>
              <th className="text-left px-4 py-3 font-semibold">Mã Sale</th>
              <th className="text-left px-4 py-3 font-semibold">Tên Sale</th>
            </tr></thead>
            <tbody>
              {filtered.map((g, i) => {
                const showDateSep = g.date !== lastDate;
                lastDate = g.date;
                return (
                  <tr key={`${g.date}-${g.requestNo}-${g.customerId}-${i}`}
                    className={`border-t ${showDateSep ? 'border-t-2 border-gray-300' : 'border-gray-100'} hover:bg-blue-50/40`}>
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-700">{fmtDateVN(g.date)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => onOpenPaymentRequest?.(g.customerId, g.requestNo, g.batchIds)} className="text-blue-600 hover:text-blue-800 underline font-medium">
                        {g.requestNo}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-mono text-blue-600">{g.customerId}</td>
                    <td className="px-4 py-3 text-gray-700">{g.customerDisplay}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{[...g.sellerNames].join(', ') || '—'}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{g.lineCount}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{fmtNum(g.totalCtsPhaiThu)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{fmtNum(g.totalDaThuKhach)}</td>
                    <td className="px-4 py-3 text-gray-600">{g.saleCode || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{g.saleName || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
