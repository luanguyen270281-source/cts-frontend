-- HR xem hết khách hàng (chỉ SELECT). Cần để filter/cột "Sale phụ trách" ở Hàng hóa theo hóa đơn hoạt động
-- với HR: list_invoice_goods_filter_options và list_invoice_goods_paged đọc customers dưới quyền người gọi.
-- Chạy trong Supabase SQL Editor.
create policy "HR xem hết khách hàng" on public.customers
  for select using (is_hr());
