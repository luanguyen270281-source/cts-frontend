-- Fix timeout (500) khi Xuất Excel / xem "Hàng hóa theo hóa đơn" ở tháng nhiều dữ liệu.
-- Nguyên nhân: cột sale_name trong list_invoice_goods_paged chạy 2 subquery tương quan lên bảng
-- customers cho TỪNG dòng trả về; subquery thứ 2 so khớp lower(trim(data->>'companyName')) không có
-- index → mỗi dòng không khớp customer_code là 1 lần quét cả bảng customers + bóc JSON.
-- Cách sửa: quét customers đúng 1 lần/lần gọi (chỉ những khách xuất hiện trong trang đang lấy),
-- rồi left join vào các dòng của trang. Kết quả (sale_name) giữ nguyên: ưu tiên khớp theo mã khách,
-- không có thì khớp theo tên công ty.
-- Thêm id vào ORDER BY để phân trang ổn định (trước đây các dòng trùng ngày + số hóa đơn có thể
-- bị lặp/sót giữa 2 lô khi xuất Excel).
-- Chạy trong Supabase SQL Editor. Giữ nguyên chữ ký hàm → chỉ thay thân hàm, không ảnh hưởng FE.

create or replace function public.list_invoice_goods_paged(
  p_search text default null,
  p_seller text default null,
  p_sale text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_accounting_received boolean default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  id uuid, invoice_no text, invoice_date date, customer_code text, customer_name text,
  seller_name text, seller_tax_code text, goods jsonb, total numeric, sale_name text,
  note text, total_count bigint
)
language sql
stable
as $function$
  with sale_customers as (
    select customer_id, lower(trim(data->>'companyName')) as name_norm
    from customers
    where p_sale is not null and p_sale <> ''
      and (data->'assignedSale'->>'name') = p_sale
  ),
  matched_ids as (
    select ig.id
    from invoice_goods ig
    join sale_customers sc on sc.customer_id = ig.customer_code
    where p_sale is not null and p_sale <> ''
    union
    select ig.id
    from invoice_goods ig
    join sale_customers sc on sc.name_norm = lower(trim(ig.customer_name))
    where p_sale is not null and p_sale <> ''
  ),
  base as (
    select ig.*
    from invoice_goods ig
    where
      (p_search is null or p_search = '' or
        ig.invoice_no ilike '%'||p_search||'%' or
        ig.customer_name ilike '%'||p_search||'%' or
        ig.customer_code ilike '%'||p_search||'%')
      and (p_seller is null or p_seller = '' or ig.seller_name = p_seller)
      and (p_date_from is null or ig.invoice_date >= p_date_from)
      and (p_date_to is null or ig.invoice_date <= p_date_to)
      and (p_accounting_received is null or ig.accounting_received = p_accounting_received)
      and (
        p_sale is null or p_sale = ''
        or ig.id in (select mi.id from matched_ids mi)
      )
  ),
  counted as materialized (
    select b.*, count(*) over() as total_count
    from base b
    order by b.invoice_date desc nulls last, b.invoice_no desc, b.id
    limit p_limit offset p_offset
  ),
  -- Chỉ những khách có Sale phụ trách và xuất hiện trong trang này → quét customers 1 lần duy nhất.
  cust as (
    select cu.customer_id,
           lower(trim(cu.data->>'companyName')) as name_norm,
           cu.data->'assignedSale'->>'name' as sale_name
    from customers cu
    where cu.data->'assignedSale'->>'name' is not null
      and (cu.customer_id in (select x.customer_code from counted x)
           or lower(trim(cu.data->>'companyName')) in (select lower(trim(y.customer_name)) from counted y))
  ),
  by_code as (
    select distinct on (customer_id) customer_id, sale_name from cust order by customer_id
  ),
  by_name as (
    select distinct on (name_norm) name_norm, sale_name from cust order by name_norm
  )
  select c.id, c.invoice_no, c.invoice_date, c.customer_code, c.customer_name,
         c.seller_name, c.seller_tax_code, c.goods, c.total,
         coalesce(bc.sale_name, bn.sale_name) as sale_name,
         c.note,
         c.total_count
  from counted c
  left join by_code bc on bc.customer_id = c.customer_code
  left join by_name bn on bn.name_norm = lower(trim(c.customer_name))
  order by c.invoice_date desc nulls last, c.invoice_no desc, c.id
$function$;

-- Hỗ trợ lọc theo khoảng ngày + sắp xếp mặc định (bảng nhỏ nên chỉ là bonus).
create index if not exists idx_invoice_goods_date_no
  on public.invoice_goods (invoice_date desc nulls last, invoice_no desc);

-- (Tùy chọn) Bản cũ không có p_accounting_received không còn được FE gọi. Có thể xóa cho gọn,
-- tránh nhầm lẫn overload:
-- drop function if exists public.list_invoice_goods_paged(text, text, text, date, date, integer, integer);
