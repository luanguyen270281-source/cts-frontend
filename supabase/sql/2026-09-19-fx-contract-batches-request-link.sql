-- Đề nghị thanh toán (Hợp đồng ngoại thương + Thanh toán hộ): mở lại ĐỦ cả giấy, lưu đủ dữ liệu ghi trên giấy.
-- CHỈ THÊM CỘT (mặc định null) — không đổi dữ liệu cũ, không đổi RLS.
-- Chạy 1 lần trong Supabase SQL editor TRƯỚC khi deploy bản frontend mới
-- (bản mới ghi vào các cột này cho CẢ 2 bảng; thiếu cột thì lưu sẽ báo lỗi).
--
-- Nên sao lưu trước (không bắt buộc, chỉ thêm cột):
--   create table fx_contract_batches_backup_20260919 as select * from public.fx_contract_batches;
--   create table cash_flow_batches_backup_20260919   as select * from public.cash_flow_batches;

-- 1) Hợp đồng ngoại thương
alter table public.fx_contract_batches
  add column if not exists request_id       uuid,     -- chung cho mọi lô của cùng 1 đề nghị
  add column if not exists fx_exchange_rate numeric,  -- Tỷ giá ở bảng "Thanh toán ngoại tệ cho khách"
  add column if not exists fx_content       text,     -- Nội dung / tài khoản nhận ở bảng ngoại tệ
  add column if not exists sale_name        text,     -- Tên Sale ghi trên giấy đề nghị
  add column if not exists sale_phone       text;     -- Số điện thoại Sale ghi trên giấy đề nghị

create index if not exists fx_contract_batches_request_id_idx
  on public.fx_contract_batches (request_id);

-- 2) Thanh toán hộ (tỷ giá ngoại tệ của luồng này đã có sẵn ở cột exchange_rate nên không cần fx_exchange_rate)
alter table public.cash_flow_batches
  add column if not exists request_id  uuid,
  add column if not exists fx_content  text,
  add column if not exists sale_name   text,
  add column if not exists sale_phone  text;

create index if not exists cash_flow_batches_request_id_idx
  on public.cash_flow_batches (request_id);

-- 3) (TUỲ CHỌN) Gắn request_id cho các lô CŨ để bấm số đề nghị mở đủ cả giấy chắc chắn hơn.
--    Nhóm theo (khách + số đề nghị + ngày đề nghị) — đúng cách frontend đang tự đoán cho lô cũ.
--    Chỉ chạy sau khi đã xem kết quả câu SELECT kiểm tra bên dưới; nếu thấy nhóm nào gộp nhầm 2 đề nghị khác nhau
--    (trùng số + trùng ngày) thì bỏ qua bước này, frontend vẫn tự đoán được như cũ.
--
--    Kiểm tra trước (mỗi dòng = 1 nhóm sẽ được gắn chung 1 request_id):
--      select customer_id, payment_request_no, order_date, count(*) as so_lo
--      from public.fx_contract_batches
--      where request_id is null and payment_request_no is not null
--      group by 1, 2, 3 order by so_lo desc;
--
--    Thực hiện:
--      with g as (
--        select customer_id, payment_request_no, order_date, gen_random_uuid() as rid
--        from public.fx_contract_batches
--        where request_id is null and payment_request_no is not null
--        group by 1, 2, 3
--      )
--      update public.fx_contract_batches b set request_id = g.rid
--      from g
--      where b.request_id is null
--        and b.customer_id = g.customer_id
--        and b.payment_request_no = g.payment_request_no
--        and b.order_date is not distinct from g.order_date;
--    (Làm tương tự cho public.cash_flow_batches nếu cần.)
