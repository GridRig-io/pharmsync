-- =====================================================================
-- PharmSync · 0002 views + row level security
-- =====================================================================

-- ---------- views (security_invoker: the caller's RLS applies) ----------

-- One row per medicine with sellable stock, quarantined stock and the next expiry
create view public.ph_stock with (security_invoker = true) as
with b as (
  select medicine_id,
         coalesce(sum(quantity) filter (where status = 'available' and expiry_date >= current_date), 0) as on_hand,
         coalesce(sum(quantity) filter (where status = 'quarantine'
                                         or (status = 'available' and expiry_date < current_date)), 0) as quarantined,
         min(expiry_date) filter (where status = 'available' and quantity > 0 and expiry_date >= current_date) as nearest_expiry,
         count(*) filter (where status = 'available' and quantity > 0) as active_batches
  from public.ph_batches
  group by medicine_id
)
select m.*,
       s.name as shelf_name,
       coalesce(b.on_hand, 0)        as on_hand,
       coalesce(b.quarantined, 0)    as quarantined,
       b.nearest_expiry,
       coalesce(b.active_batches, 0) as active_batches,
       case when coalesce(b.on_hand, 0) = 0             then 'out'
            when coalesce(b.on_hand, 0) <= m.reorder_level then 'low'
            else 'ok' end as stock_status
from public.ph_medicines m
left join b on b.medicine_id = m.id
left join public.ph_shelves s on s.id = m.default_shelf_id;

-- Batches with names and days left, for the expiry board and quarantine shelf
create view public.ph_batch_overview with (security_invoker = true) as
select b.*,
       m.name as medicine_name, m.strength, m.form, m.unit, m.class,
       s.name as shelf_name,
       sp.name as supplier_name, sp.accepts_returns, sp.return_window_days,
       (b.expiry_date - current_date) as days_left
from public.ph_batches b
join public.ph_medicines m on m.id = b.medicine_id
left join public.ph_shelves s on s.id = b.shelf_id
left join public.ph_suppliers sp on sp.id = b.supplier_id;

-- Prescription lines with how much is left and until when they can be filled
create view public.ph_rx_items with (security_invoker = true) as
select pi.*,
       p.patient_name, p.prescriber_name, p.prescriber_mdcn, p.date_written, p.is_repeat, p.signed_at, p.signed_by,
       m.name as medicine_name, m.strength, m.unit,
       (p.date_written + case when p.is_repeat then ph.rx_repeat_valid_days else ph.rx_valid_days end) as valid_until,
       (pi.qty_prescribed - pi.qty_dispensed) as remaining
from public.ph_prescription_items pi
join public.ph_prescriptions p on p.id = pi.prescription_id
join public.ph_pharmacies ph on ph.id = p.pharmacy_id
join public.ph_medicines m on m.id = pi.medicine_id;

-- Controlled drugs register: every movement of a controlled medicine with its running balance
create view public.ph_controlled_register with (security_invoker = true) as
select mv.id, mv.pharmacy_id, mv.medicine_id, mv.batch_id, mv.type, mv.quantity_delta, mv.reason,
       mv.balance_after, mv.created_at, mv.performed_by, mv.sale_id, mv.prescription_id,
       st.full_name as performer_name, b.batch_no,
       p.prescriber_name, p.patient_name, sa.number as sale_number
from public.ph_movements mv
join public.ph_medicines m on m.id = mv.medicine_id and m.class = 'controlled'
left join public.ph_staff st on st.id = mv.performed_by
left join public.ph_batches b on b.id = mv.batch_id
left join public.ph_prescriptions p on p.id = mv.prescription_id
left join public.ph_sales sa on sa.id = mv.sale_id;

-- ---------- RLS ----------
do $$
declare t text;
begin
  foreach t in array array['ph_pharmacies','ph_staff','ph_staff_pins','ph_shelves','ph_suppliers','ph_medicines',
    'ph_batches','ph_sales','ph_prescriptions','ph_prescription_items','ph_sale_items','ph_movements',
    'ph_controlled_counts','ph_temperature_logs','ph_recalls','ph_daily_checks','ph_audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
-- ph_staff_pins: RLS on and no policies on purpose (only security-definer functions read it)

create policy ph_read on public.ph_pharmacies for select to authenticated using (id = public.ph_my_pharmacy());
create policy ph_admin_update on public.ph_pharmacies for update to authenticated
  using (id = public.ph_my_pharmacy() and public.ph_has_role('admin'))
  with check (id = public.ph_my_pharmacy() and public.ph_has_role('admin'));

create policy ph_read on public.ph_staff for select to authenticated
  using (id = auth.uid() or pharmacy_id = public.ph_my_pharmacy());
create policy ph_update on public.ph_staff for update to authenticated
  using (id = auth.uid() or (pharmacy_id = public.ph_my_pharmacy() and public.ph_has_role('admin')))
  with check (id = auth.uid() or (pharmacy_id = public.ph_my_pharmacy() and public.ph_has_role('admin')));

-- Everyone in the pharmacy reads shared data
do $$
declare t text;
begin
  foreach t in array array['ph_shelves','ph_suppliers','ph_medicines','ph_batches','ph_sales','ph_prescriptions',
    'ph_prescription_items','ph_sale_items','ph_movements','ph_controlled_counts','ph_temperature_logs',
    'ph_recalls','ph_daily_checks']
  loop
    execute format('create policy ph_read on public.%I for select to authenticated using (pharmacy_id = public.ph_my_pharmacy())', t);
  end loop;
end $$;

-- Medicines, shelves, suppliers: pharmacists and inventory staff
do $$
declare t text;
begin
  foreach t in array array['ph_shelves','ph_suppliers','ph_medicines']
  loop
    execute format($f$create policy ph_insert on public.%I for insert to authenticated
      with check (pharmacy_id = public.ph_my_pharmacy() and public.ph_has_role('admin','pharmacist','inventory_officer'))$f$, t);
    execute format($f$create policy ph_update on public.%I for update to authenticated
      using (pharmacy_id = public.ph_my_pharmacy() and public.ph_has_role('admin','pharmacist','inventory_officer'))
      with check (pharmacy_id = public.ph_my_pharmacy() and public.ph_has_role('admin','pharmacist','inventory_officer'))$f$, t);
  end loop;
end $$;
create policy ph_delete on public.ph_shelves for delete to authenticated
  using (pharmacy_id = public.ph_my_pharmacy() and public.ph_has_role('admin','pharmacist'));
create policy ph_delete on public.ph_suppliers for delete to authenticated
  using (pharmacy_id = public.ph_my_pharmacy() and public.ph_has_role('admin','pharmacist'));

-- Batches: moving shelves is a direct update; quantity and status are guarded by trigger
create policy ph_update on public.ph_batches for update to authenticated
  using (pharmacy_id = public.ph_my_pharmacy() and public.ph_has_role('admin','pharmacist','inventory_officer'))
  with check (pharmacy_id = public.ph_my_pharmacy() and public.ph_has_role('admin','pharmacist','inventory_officer'));

-- Temperature readings and opening checks: anyone on shift
create policy ph_insert on public.ph_temperature_logs for insert to authenticated
  with check (pharmacy_id = public.ph_my_pharmacy());
create policy ph_insert on public.ph_daily_checks for insert to authenticated
  with check (pharmacy_id = public.ph_my_pharmacy());
create policy ph_delete on public.ph_daily_checks for delete to authenticated
  using (pharmacy_id = public.ph_my_pharmacy() and day = current_date);

-- Recalls are opened through ph_create_recall(); pharmacists close them
create policy ph_update on public.ph_recalls for update to authenticated
  using (pharmacy_id = public.ph_my_pharmacy() and public.ph_has_role('admin','pharmacist'))
  with check (pharmacy_id = public.ph_my_pharmacy() and public.ph_has_role('admin','pharmacist'));

create policy ph_audit_read on public.ph_audit_log for select to authenticated
  using (pharmacy_id = public.ph_my_pharmacy() and public.ph_has_role('admin'));

-- Sales, sale items, movements, prescriptions and controlled counts have no
-- insert/update/delete policies: they are written only by the functions in 0003,
-- which enforce the prescription lock, first-expiry-first-out and stock limits.
