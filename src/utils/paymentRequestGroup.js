// Tìm tất cả các lô hàng thuộc CÙNG 1 Đề Nghị Thanh Toán với 1 dòng cho trước, để bấm vào số đề nghị
// mở ra ĐỦ cả giấy (mọi dòng chứng từ + ngoại tệ), không chỉ đúng 1 lô.
// - Lô mới (Hợp đồng ngoại thương) có request_id chung → khớp chính xác theo id đó.
// - Lô cũ chưa có request_id → khớp theo (khách hàng + số đề nghị + ngày đề nghị). Số đề nghị do người dùng gõ tay
//   nên có thể trùng giữa 2 đề nghị khác nhau; thêm ngày để giảm nhầm lẫn.
export const siblingBatchIds = (row, batches) => {
  if (!row) return [];
  if (row.request_id) {
    const ids = batches.filter(b => b.request_id === row.request_id).map(b => b.id);
    if (ids.length) return ids;
  }
  const no = String(row.payment_request_no ?? '');
  const ids = batches
    .filter(b => !b.request_id
      && b.customer_id === row.customer_id
      && String(b.payment_request_no ?? '') === no
      && (b.order_date || '') === (row.order_date || ''))
    .map(b => b.id);
  return ids.length ? ids : [row.id];
};
