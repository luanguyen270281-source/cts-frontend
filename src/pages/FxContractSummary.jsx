// File: src/pages/FxContractSummary.jsx
// Tổng hợp Hợp đồng ngoại thương — theo từng khách hàng:
// Tổng khách chuyển = cộng dồn "Tiền vào" (CNY, customer_paid_total) từ TẤT CẢ lô hàng của khách đó.
// Đã thanh toán = cộng dồn "Tiền ra" (amount_cny) từ các lô đó. (Không cộng thêm deposit_vnd: từ 27/07 cột này chỉ là
// bản sao tổng số tệ của cả đề nghị, cộng vào sẽ đếm đôi/nhân N lần.)
// Còn lại = Tổng khách chuyển - Đã thanh toán.
import { useState, useMemo } from 'react';
import { fmtNum } from '../helpers';
import { PaymentRequestPrint } from './PaymentRequestPrint';
import { CashFlowPage } from './CashFlowPage';

export const FxContractSummary = ({ batches = [], customers = {}, sellers = {}, isAdmin = false, onSave, onDelete, onOpenPaymentRequest }) => {
  const [search, setSearch] = useState('');
  const [printCustomerId, setPrintCustomerId] = useState(null);
  const [detailCustomerId, setDetailCustomerId] = useState(undefined); // undefined = không xem chi tiết; '' = xem tất cả; 'CTSxxx' = 1 khách

  const rows = useMemo(() => {
    const byCustomer = {};
    batches.forEach(b => {
      const id = b.customer_id;
      if (!id) return;
      if (!byCustomer[id]) {
        byCustomer[id] = { customerId: id, batchCount: 0, walletBalance: 0, totalPaid: 0 };
      }
      const r = byCustomer[id];
      r.batchCount += 1;
      r.walletBalance += Number(b.customer_paid_total) || 0; // Tổng khách chuyển (CNY)
      r.totalPaid += Number(b.amount_cny) || 0; // Đã thanh toán = Tiền ra (cột I "Số tệ") — khớp Còn lại = H−I ở bảng chi tiết
    });
    return Object.values(byCustomer).map(r => ({ ...r, remaining: r.walletBalance - r.totalPaid }));
  }, [batches]);

  const customerLabel = (id) => customers[id]?.companyName || id;

  const filtered = rows.filter(r => {
    const s = search.trim().toLowerCase();
    return !s || r.customerId.toLowerCase().includes(s) || customerLabel(r.customerId).toLowerCase().includes(s);
  });

  const grandTotal = filtered.reduce((acc, r) => ({
    batchCount: acc.batchCount + r.batchCount,
    walletBalance: acc.walletBalance + r.walletBalance,
    totalPaid: acc.totalPaid + r.totalPaid,
    remaining: acc.remaining + r.remaining,
  }), { batchCount: 0, walletBalance: 0, totalPaid: 0, remaining: 0 });

  if (detailCustomerId !== undefined) {
    return (
      <CashFlowPage
        isFxContract
        batches={batches} customers={customers} sellers={sellers} isAdmin={isAdmin}
        onSave={onSave} onDelete={onDelete}
        initialCustomerFilter={detailCustomerId}
        onBack={() => setDetailCustomerId(undefined)}
        onOpenPaymentRequest={onOpenPaymentRequest}
      />
    );
  }

  if (printCustomerId) {
    const batchesOfCustomer = batches.filter(b => b.customer_id === printCustomerId);
    return (
      <PaymentRequestPrint
        customerId={printCustomerId}
        customer={customers[printCustomerId]}
        batches={batchesOfCustomer}
        customers={customers}
        sellers={sellers}
        docLabel="Hợp Đồng Ngoại Thương"
        onSave={onSave}
        onClose={() => setPrintCustomerId(null)}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800">🏦 Tổng hợp Hợp đồng ngoại thương</h1>
        </div>
        <button onClick={() => setDetailCustomerId('')}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium shadow">+ Nhập / xem lô hàng</button>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Tìm theo mã hoặc tên khách hàng..."
        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-300" />

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-400">Chưa có dữ liệu nào để tổng hợp.</div>
        ) : (
          <table className="w-full text-sm min-w-[800px]">
            <thead><tr className="bg-gray-50 text-gray-500 text-xs uppercase">
              <th className="text-left px-4 py-3 font-semibold">Mã KH</th>
              <th className="text-left px-4 py-3 font-semibold">Tên khách hàng</th>
              <th className="text-center px-4 py-3 font-semibold">Số lô</th>
              <th className="text-right px-4 py-3 font-semibold">Tổng khách chuyển (CNY)</th>
              <th className="text-right px-4 py-3 font-semibold">Đã thanh toán (CNY)</th>
              <th className="text-right px-4 py-3 font-semibold text-rose-700 bg-rose-50">Còn lại (CNY)</th>
              <th className="px-4 py-3 w-24"></th>
            </tr></thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.customerId} className={`border-t border-gray-100 hover:bg-blue-50/40 transition-colors ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                  <td className="px-4 py-3 font-mono font-semibold text-blue-600">{r.customerId}</td>
                  <td className="px-4 py-3 text-gray-700">{customerLabel(r.customerId)}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{r.batchCount}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{fmtNum(r.walletBalance)}</td>
                  <td className="px-4 py-3 text-right text-emerald-600">{fmtNum(r.totalPaid)}</td>
                  <td className={`px-4 py-3 text-right font-semibold bg-rose-50/70 ${r.remaining < 0 ? 'text-red-600' : 'text-gray-700'}`}>{fmtNum(r.remaining)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setDetailCustomerId(r.customerId)} className="text-gray-600 hover:text-gray-800">🔍 Chi tiết</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 font-semibold bg-gray-50">
                <td className="px-4 py-3" colSpan={2}>TỔNG CỘNG</td>
                <td className="px-4 py-3 text-center">{grandTotal.batchCount}</td>
                <td className="px-4 py-3 text-right">{fmtNum(grandTotal.walletBalance)}</td>
                <td className="px-4 py-3 text-right">{fmtNum(grandTotal.totalPaid)}</td>
                <td className="px-4 py-3 text-right bg-rose-100/70 text-rose-700">{fmtNum(grandTotal.remaining)}</td>
                <td className="px-4 py-3 bg-rose-100/70"></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
};
