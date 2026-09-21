-- Cho mọi role (admin/sale/hr) sửa cột invoice_note (Ghi chú hóa đơn). note (Tình trạng hóa đơn) vẫn chỉ admin.
-- Chạy trong Supabase SQL Editor.
create or replace function public.invoice_goods_guard_workflow_columns()
returns trigger language plpgsql as $$
declare allowed text[];
begin
  if is_admin() then return new; end if;
  if is_hr() then
    allowed := array['hr_sent','hr_sent_date','invoice_note'];
  else
    allowed := array['sale_sent','sale_sent_date','deadline_days','invoice_note'];
  end if;
  if exists (
    select 1
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value and n.key <> all (allowed)
  ) then
    raise exception 'Bạn không có quyền sửa cột này của hóa đơn';
  end if;
  return new;
end; $$;
