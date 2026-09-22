// File: src/pages/InvoiceAddressPrint.jsx
// In tem gửi/nhận (Người gửi = bên bán, Người nhận = khách hàng) cho các hóa đơn đã chọn —
// nhiều tem xếp liên tiếp trên CÙNG 1 tờ A4 (không phải 1 tem/1 tờ, đỡ phí giấy), mỗi tem chiếm
// gần hết bề ngang tờ giấy, có đường kẻ đứt + dấu cắt giữa các tem để tiện cắt rời rồi dán.
// Khung viền ngoài đặt trên 1 div riêng (không phải border của <table>) — bảng "border-collapse"
// full-width hay bị Chrome làm tròn số thập phân lệch mất đúng 1 cạnh (thường là phải/dưới) khi in
// thật (không lỗi khi xem trên màn hình bình thường), div viền ngoài đơn không bị lỗi này. Tách
// riêng khỏi PRINT_STYLE (thay vì gộp chung) vì đây là phần CSS an toàn để chèn sống vào trang —
// chỉ phụ thuộc class riêng ".label-frame", không đụng tới "body"/thẻ trần như PRINT_STYLE.
const LABEL_FRAME_STYLE = `
  .label-frame { border: 1px solid #000; width: calc(100% - 2px); box-sizing: border-box; overflow: hidden; }
  .label-frame table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  .label-frame td { border: none; border-bottom: 1px solid #000; padding: 6px 10px; box-sizing: border-box; word-wrap: break-word; }
  .label-frame td:first-child { border-right: 1px solid #000; }
  .label-frame tr:last-child td { border-bottom: none; }
`;

const PRINT_STYLE = `
  @page { size: A4 portrait; margin: 12mm 15mm; }
  body { font-family: 'Times New Roman', serif; font-size: 14px; line-height: 1.6; background: #fff; color: #000; margin: 0; padding: 0; }
  ${LABEL_FRAME_STYLE}
  tr, td { page-break-inside: avoid !important; break-inside: avoid !important; }
  .no-print { display: none !important; }
  .bulk-item { break-inside: avoid; page-break-inside: avoid; }
`;

// Đối chiếu bên bán của hóa đơn với danh sách "sellers" — hóa đơn chỉ lưu tên/MST dạng chuỗi
// (không có id), nên ưu tiên khớp theo MST (chắc chắn hơn), khớp theo tên nếu không có MST.
const findSeller = (sellers, inv) => {
  const list = Object.values(sellers || {});
  if (inv.seller_tax_code) {
    const byTax = list.find((s) => s.taxCode && s.taxCode.trim() === inv.seller_tax_code.trim());
    if (byTax) return byTax;
  }
  if (inv.seller_name) {
    const target = inv.seller_name.trim().toLowerCase();
    const byName = list.find((s) => (s.companyName || '').trim().toLowerCase() === target);
    if (byName) return byName;
  }
  return null;
};

// Ngoài thực tế, Người gửi và Người nhận là 2 tem dán ở 2 vị trí riêng trên kiện hàng (không dán
// chung 1 chỗ) — nên mỗi bên là 1 khung riêng, có đường kẻ ở giữa để tách rời. KHÔNG chữ đè lên
// đường kẻ (từng có chữ "cắt tại đây" nhưng cắt kéo ngay trên chữ sẽ bị lẹm chữ, không thực tế) —
// chỉ phân biệt 2 loại ranh giới bằng độ đậm: đường "major" (ngăn giữa 2 HÓA ĐƠN khác nhau) đậm hơn
// hẳn đường "minor" (ngăn Gửi/Nhận trong cùng 1 hóa đơn).
const CutLine = ({ major = false }) => (
  <div style={{ margin: '14px 0', borderTop: major ? '3px dashed #333' : '1px dashed #bbb' }} />
);

const AddressBox = ({ title, name, address, phone }) => (
  <div className="label-frame">
    <table>
      <tbody>
        <tr><td style={{ width: 120 }}><b>{title}:</b></td><td>{name || '—'}</td></tr>
        <tr><td><b>Địa chỉ:</b></td><td>{address || '—'}</td></tr>
        <tr><td><b>Điện thoại:</b></td><td>{phone || '—'}</td></tr>
      </tbody>
    </table>
  </div>
);

const AddressLabel = ({ sender, receiver }) => (
  <div>
    <AddressBox title="Người gửi" name={sender.name} address={sender.address} phone={sender.phone} />
    <CutLine />
    <AddressBox title="Người nhận" name={receiver.name} address={receiver.address} phone={receiver.phone} />
  </div>
);

// Địa chỉ kho/văn phòng gửi hàng thực tế — cố định, không lấy theo địa chỉ đăng ký của từng Bên
// bán (mỗi hóa đơn có thể đứng tên pháp nhân bán khác nhau nhưng hàng đều gửi từ cùng 1 kho này).
const SENDER_ADDRESS = 'Số 67 Đường 23, Thành Phố Giao Lưu, Đông Ngạc, Hà Nội';

const AddressSheet = ({ inv, customers, sellers }) => {
  const seller = findSeller(sellers, inv);
  const customer = (customers || {})[inv.customer_code] || null;

  const senderName = seller?.companyName || inv.seller_name || '';
  const senderAddress = SENDER_ADDRESS;
  const senderPhone = seller?.phone || '';

  // Tên người nhận: ưu tiên "Tên người nhận hàng" ghép với tên công ty (VD: "Chị A : CÔNG TY ABC"),
  // không có thì chỉ hiện tên công ty. Địa chỉ nhận: ưu tiên "Địa chỉ nhận hàng", chưa nhập thì tạm
  // dùng địa chỉ công ty (đa số khách hàng cũ chưa điền 2 field mới này).
  const companyName = customer?.companyName || inv.customer_name || '';
  const receiverName = customer?.receiverName ? `${customer.receiverName} : ${companyName}` : companyName;
  const receiverAddress = customer?.receivingAddress || customer?.address || '';
  const receiverPhone = customer?.phone || '';

  return (
    <div>
      {/* Dòng này chỉ để biết tem của hóa đơn nào — không dán lên hàng, sẽ bị cắt bỏ, nên chỉ ngăn
          bằng đường mảnh (không phải đường đậm ranh giới giữa 2 hóa đơn). */}
      <p style={{ margin: 0 }}><b>Số hóa đơn:</b> {inv.invoice_no} &nbsp;&nbsp; <b>Ngày:</b> {inv.invoice_date || '—'}</p>
      <CutLine />
      <AddressLabel
        sender={{ name: senderName, address: senderAddress, phone: senderPhone }}
        receiver={{ name: receiverName, address: receiverAddress, phone: receiverPhone }}
      />
    </div>
  );
};

export const InvoiceAddressPrint = ({ invoices, customers, sellers, onClose }) => {
  const getFullHtml = (innerHTML) => {
    const styleLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .map((el) => `<link rel="stylesheet" href="${el.href}">`).join('\n');
    const styleTags = Array.from(document.querySelectorAll('style')).map((el) => el.outerHTML).join('\n');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Tem gửi nhận</title>${styleLinks}${styleTags}<style>${PRINT_STYLE}</style></head><body>${innerHTML}</body></html>`;
  };

  const doPrint = () => {
    const content = document.getElementById('invoice-address-print-zone').innerHTML;
    const w = window.open('', '_blank');
    if (!w) {
      alert('Trình duyệt đang chặn cửa sổ bật lên (popup). Vui lòng cho phép popup cho trang này rồi bấm lại.');
      return;
    }
    w.document.write(getFullHtml(content));
    w.document.close();
    w.onload = () => { w.focus(); w.print(); w.close(); };
    setTimeout(() => { if (!w.closed) { w.focus(); w.print(); w.close(); } }, 800);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 overflow-auto flex items-start justify-center p-4 pt-8">
      <div className="bg-white w-full max-w-2xl rounded-xl shadow-2xl">
        {/* Chèn phần CSS khung/bảng để preview trên màn hình khớp bản in thật — CHỈ phần class
            ".label-frame" (không lấy nguyên PRINT_STYLE vì nó còn có "body{...}"/".no-print{display:none}"
            sẽ phá layout cả app đang chạy phía sau modal). getFullHtml() bên dưới vẫn tự nhặt thẻ
            <style> này + gộp thêm PRINT_STYLE đầy đủ khi mở cửa sổ in thật. */}
        <style>{LABEL_FRAME_STYLE}</style>
        <div className="flex items-center justify-between px-6 py-4 border-b no-print flex-wrap gap-2">
          <div className="font-semibold text-gray-700">Tem gửi/nhận — {invoices.length} hóa đơn</div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={doPrint} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 flex items-center gap-1.5">
              🖨️ In / PDF
            </button>
            <button onClick={onClose} className="bg-gray-100 px-4 py-2 rounded-lg text-sm hover:bg-gray-200">✕ Đóng</button>
          </div>
        </div>
        <div className="p-10" id="invoice-address-print-zone">
          {invoices.map((inv, i) => (
            <div key={inv.id}>
              {i > 0 && <CutLine major />}
              <div className="bulk-item">
                <AddressSheet inv={inv} customers={customers} sellers={sellers} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
