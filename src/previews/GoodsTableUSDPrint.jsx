// File: src/previews/GoodsTableUSDPrint.jsx
import { calcUSDTotal, fmtNum, formatThousands } from '../helpers';

// Đơn giá USD có thể có số thập phân (vd 0.23) — fmtNum làm tròn về số nguyên nên không dùng được ở đây.
const fmtDonGia = (n) => formatThousands(n, 4);

export const GoodsTableUSDPrint = ({ goods, exchangeRate }) => {
  const totalUsd = calcUSDTotal(goods);
  const rate = Number(exchangeRate) || 0;
  const totalVnd = Math.round(totalUsd * rate);
  return (
    <div className="mb-2">
      <table className="w-full border-collapse border border-gray-400 text-sm mb-1">
        <thead>
          <tr className="bg-gray-50">
            <th className="border border-gray-400 px-2 py-1 w-8">STT</th>
            <th className="border border-gray-400 px-2 py-1">Tên hàng</th>
            <th className="border border-gray-400 px-2 py-1 w-14">ĐVT</th>
            <th className="border border-gray-400 px-2 py-1 w-16">SL</th>
            <th className="border border-gray-400 px-2 py-1 w-24">Đơn giá (USD)</th>
            <th className="border border-gray-400 px-2 py-1 w-24">Thành tiền (USD)</th>
          </tr>
        </thead>
        <tbody>
          {(goods || []).length === 0 ? (
            <tr><td colSpan="6" className="border border-gray-400 px-2 py-2 text-center text-gray-400 italic">Chưa có hàng hóa</td></tr>
          ) : goods.map((g, i) => (
            <tr key={i} style={{ pageBreakInside: 'avoid', breakInside: 'avoid' }}>
              <td className="border border-gray-400 px-2 py-1 text-center">{i + 1}</td>
              <td className="border border-gray-400 px-2 py-1">{g.tenHang}</td>
              <td className="border border-gray-400 px-2 py-1 text-center">{g.dvt}</td>
              <td className="border border-gray-400 px-2 py-1 text-right">{fmtNum(g.soLuong)}</td>
              <td className="border border-gray-400 px-2 py-1 text-right">{fmtDonGia(g.donGia)}</td>
              <td className="border border-gray-400 px-2 py-1 text-right">{fmtNum(g.thanhTien)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-gray-50 font-medium">
            <td colSpan="5" className="border border-gray-400 px-2 py-1.5 text-right">Tổng giá trị tiền hàng theo tờ khai tạm tính (USD):</td>
            <td className="border border-gray-400 px-2 py-1.5 text-right">{fmtNum(totalUsd)}</td>
          </tr>
        </tfoot>
      </table>
      <div className="text-sm flex justify-between bg-gray-50 border border-gray-300 rounded px-3 py-1.5">
        <span>Tổng giá trị tiền hàng theo tỷ giá thỏa thuận tạm tính (VNĐ):</span>
        <strong>{fmtNum(totalVnd)} đ</strong>
      </div>
    </div>
  );
};
