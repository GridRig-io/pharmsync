-- =====================================================================
-- PharmSync · 0003 triggers and functions
-- The rules that matter (prescription lock, first-expiry-first-out,
-- stock never below zero, pharmacist sign-off) live here, in the
-- database, so no screen can skip them.
-- =====================================================================

-- ---------- updated_at ----------
create or replace function public.ph_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['ph_pharmacies','ph_staff','ph_medicines','ph_batches']
  loop
    execute format('create trigger trg_ph_touch before update on public.%I
                    for each row execute function public.ph_touch_updated_at()', t);
  end loop;
end $$;

-- ---------- staff guard ----------
create or replace function public.ph_guard_staff()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;          -- service role / SQL editor
  if new.pharmacy_id is distinct from old.pharmacy_id then
    raise exception 'Pharmacy membership can only be changed by the system';
  end if;
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and not public.ph_has_role('admin') then
    raise exception 'Only the superintendent pharmacist (admin) can change roles or deactivate staff';
  end if;
  new.email := old.email;
  if old.role = 'admin' and old.is_active and (new.role <> 'admin' or not new.is_active)
     and not exists (select 1 from public.ph_staff s
                     where s.pharmacy_id = old.pharmacy_id and s.id <> old.id and s.role = 'admin' and s.is_active) then
    raise exception 'The pharmacy needs at least one active admin';
  end if;
  return new;
end $$;

create trigger trg_ph_guard_staff before update on public.ph_staff
  for each row execute function public.ph_guard_staff();

-- ---------- medicine guard: only the admin decides what is prescription-only ----------
create or replace function public.ph_guard_medicine()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.class <> 'otc' and not public.ph_has_role('admin','pharmacist') then
      raise exception 'Only a pharmacist can add prescription-only or controlled medicines';
    end if;
  elsif new.class is distinct from old.class and not public.ph_has_role('admin') then
    raise exception 'Only the superintendent pharmacist (admin) can change whether a medicine needs a prescription';
  end if;
  return new;
end $$;

create trigger trg_ph_guard_medicine before insert or update on public.ph_medicines
  for each row execute function public.ph_guard_medicine();

-- ---------- batch guard: quantity only through movements, status only through functions ----------
create or replace function public.ph_guard_batch()
returns trigger language plpgsql set search_path = public as $$
declare v_rpc boolean := coalesce(current_setting('ph.rpc', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not v_rpc and auth.uid() is not null then
      raise exception 'Receive stock through a delivery';
    end if;
    new.quantity := 0;
    return new;
  end if;
  if new.quantity is distinct from old.quantity and pg_trigger_depth() < 2 then
    raise exception 'Stock changes only through a sale, delivery, count or disposal';
  end if;
  if not v_rpc and auth.uid() is not null and (
       new.status is distinct from old.status
    or new.quarantine_reason is distinct from old.quarantine_reason
    or new.medicine_id is distinct from old.medicine_id
    or new.batch_no is distinct from old.batch_no
    or new.expiry_date is distinct from old.expiry_date) then
    raise exception 'Use Quarantine, Release or Dispose to change a batch';
  end if;
  return new;
end $$;

create trigger trg_ph_guard_batch before insert or update on public.ph_batches
  for each row execute function public.ph_guard_batch();

-- ---------- movement → batch quantity + running balance ----------
create or replace function public.ph_apply_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_batch public.ph_batches; v_name text; v_unit text;
begin
  select * into v_batch from public.ph_batches where id = new.batch_id for update;
  if v_batch.id is null then raise exception 'Batch not found'; end if;
  if v_batch.medicine_id <> new.medicine_id then raise exception 'Batch does not belong to this medicine'; end if;
  if v_batch.pharmacy_id <> new.pharmacy_id then raise exception 'Batch belongs to another pharmacy'; end if;
  if v_batch.quantity + new.quantity_delta < 0 then
    select name, unit into v_name, v_unit from public.ph_medicines where id = new.medicine_id;
    raise exception 'Not enough % in batch % (% % left)', v_name, v_batch.batch_no, v_batch.quantity, v_unit
      using errcode = 'P0001';
  end if;

  update public.ph_batches set quantity = quantity + new.quantity_delta where id = new.batch_id;

  select coalesce(sum(quantity), 0) into new.balance_after
    from public.ph_batches where medicine_id = new.medicine_id and status <> 'disposed';
  return new;
end $$;

create trigger trg_ph_apply_movement before insert on public.ph_movements
  for each row execute function public.ph_apply_movement();

-- ---------- temperature → out-of-range flag ----------
create or replace function public.ph_check_temperature()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.ph_pharmacies;
begin
  select * into p from public.ph_pharmacies where id = new.pharmacy_id;
  new.out_of_range := case new.kind
    when 'fridge' then new.reading_c < p.fridge_min_c or new.reading_c > p.fridge_max_c
    else new.reading_c > p.room_max_c end;
  if new.out_of_range and coalesce(trim(new.action_taken), '') = '' then
    raise exception 'Reading is out of range. Write down what you did about it.';
  end if;
  return new;
end $$;

create trigger trg_ph_check_temperature before insert on public.ph_temperature_logs
  for each row execute function public.ph_check_temperature();

-- ---------- audit ----------
create or replace function public.ph_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.ph_audit_log (pharmacy_id, table_name, record_id, action, actor_id, old_data, new_data)
  values (coalesce((v_row->>'pharmacy_id')::uuid, case when tg_table_name = 'ph_pharmacies' then (v_row->>'id')::uuid end),
          tg_table_name, v_row->>'id', lower(tg_op), auth.uid(),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['ph_pharmacies','ph_staff','ph_medicines','ph_batches','ph_suppliers','ph_shelves',
                           'ph_recalls','ph_sales','ph_prescriptions','ph_controlled_counts']
  loop
    execute format('create trigger trg_ph_audit after insert or update or delete on public.%I
                    for each row execute function public.ph_audit()', t);
  end loop;
end $$;

-- =====================================================================
-- Functions the app calls (RPC)
-- =====================================================================

-- Fail unless the caller is active staff (optionally with one of the roles); returns their pharmacy
create or replace function public.ph_require(variadic roles public.ph_role[] default null)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_ph uuid := public.ph_my_pharmacy();
begin
  if v_ph is null then raise exception 'You are not on the staff of a pharmacy'; end if;
  if roles is not null and not public.ph_has_role(variadic roles) then
    raise exception 'You don''t have permission to do this' using errcode = '42501';
  end if;
  return v_ph;
end $$;

-- ---------- signing PIN ----------
create or replace function public.ph_set_pin(p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.ph_require();
  if p_pin !~ '^\d{4,6}$' then raise exception 'PIN must be 4 to 6 digits'; end if;
  insert into public.ph_staff_pins (staff_id, pin_hash, updated_at)
  values (auth.uid(), crypt(p_pin, gen_salt('bf')), now())
  on conflict (staff_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
end $$;

create or replace function public.ph_has_pin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ph_staff_pins where staff_id = auth.uid())
$$;

-- internal: not callable by the app (no brute-forcing)
create or replace function public.ph_check_pin(p_staff uuid, p_pin text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select pin_hash = crypt(p_pin, pin_hash) from public.ph_staff_pins where staff_id = p_staff), false)
$$;

-- ---------- receive a delivery ----------
create or replace function public.ph_receive(
  p_medicine uuid, p_batch_no text, p_expiry date, p_qty numeric,
  p_shelf uuid default null, p_supplier uuid default null, p_cost numeric default null,
  p_checks jsonb default '{}', p_quarantine_reason public.ph_quarantine_reason default null,
  p_note text default null, p_override_shelf_life boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_ph uuid := public.ph_require('admin','pharmacist','inventory_officer');
  v_p public.ph_pharmacies; v_med public.ph_medicines; v_batch uuid;
  v_status public.ph_batch_status := case when p_quarantine_reason is null then 'available' else 'quarantine' end;
  v_sup text;
begin
  select * into v_p from public.ph_pharmacies where id = v_ph;
  select * into v_med from public.ph_medicines where id = p_medicine and pharmacy_id = v_ph;
  if v_med.id is null then raise exception 'Medicine not found'; end if;
  if coalesce(trim(p_batch_no), '') = '' then raise exception 'Enter the batch number printed on the pack'; end if;
  if p_expiry is null then raise exception 'Enter the expiry date printed on the pack'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'Enter how many % arrived', v_med.unit; end if;

  if v_status = 'available' then
    if p_expiry < current_date then
      raise exception 'This batch has already expired. Send it to quarantine instead.';
    end if;
    if p_expiry < current_date + v_p.min_shelf_life_days then
      if not (p_override_shelf_life and public.ph_has_role('admin','pharmacist')) then
        raise exception 'Only % days left before expiry. Your rule is at least % days: refuse it, or ask a pharmacist to accept it.',
          p_expiry - current_date, v_p.min_shelf_life_days;
      end if;
    end if;
  end if;

  perform set_config('ph.rpc', 'on', true);

  select id into v_batch from public.ph_batches
   where medicine_id = p_medicine and upper(batch_no) = upper(trim(p_batch_no))
     and expiry_date = p_expiry and status = v_status
   limit 1;

  if v_batch is null then
    insert into public.ph_batches (pharmacy_id, medicine_id, batch_no, expiry_date, supplier_id, shelf_id, cost_price,
                                   status, quarantine_reason, quarantine_note, quarantined_at, receive_checks)
    values (v_ph, p_medicine, upper(trim(p_batch_no)), p_expiry, p_supplier, coalesce(p_shelf, v_med.default_shelf_id),
            coalesce(p_cost, v_med.cost_price), v_status, p_quarantine_reason, p_note,
            case when v_status = 'quarantine' then now() end, p_checks)
    returning id into v_batch;
  end if;

  select name into v_sup from public.ph_suppliers where id = p_supplier;
  insert into public.ph_movements (pharmacy_id, medicine_id, batch_id, type, quantity_delta, reason)
  values (v_ph, p_medicine, v_batch, 'receive', p_qty,
          concat_ws(' · ', 'Delivery', v_sup, case when v_status = 'quarantine' then 'to quarantine' end));
  return v_batch;
end $$;

-- ---------- record a prescription (pharmacist signs with PIN) ----------
create or replace function public.ph_create_prescription(p jsonb, p_items jsonb, p_signer uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ph uuid := public.ph_require();
  v_p public.ph_pharmacies; v_signer public.ph_staff;
  v_id uuid; v_written date; v_repeat boolean; v_limit int;
  v_item jsonb; v_med public.ph_medicines; v_out jsonb := '[]'; v_item_id uuid;
begin
  select * into v_p from public.ph_pharmacies where id = v_ph;
  select * into v_signer from public.ph_staff where id = p_signer and pharmacy_id = v_ph and is_active;
  if v_signer.id is null or v_signer.role not in ('admin','pharmacist') then
    raise exception 'A pharmacist on this pharmacy''s staff must sign the prescription';
  end if;
  if not exists (select 1 from public.ph_staff_pins where staff_id = p_signer) then
    raise exception '% has not set a signing PIN yet (Settings → My PIN)', coalesce(v_signer.full_name, 'This pharmacist');
  end if;
  if not public.ph_check_pin(p_signer, coalesce(p_pin, '')) then
    raise exception 'Wrong PIN for %', coalesce(v_signer.full_name, 'this pharmacist');
  end if;

  if coalesce(trim(p->>'patient_name'), '') = '' then raise exception 'Enter the patient''s name'; end if;
  if coalesce(trim(p->>'prescriber_name'), '') = '' then raise exception 'Enter the prescriber''s name'; end if;
  if coalesce(trim(p->>'prescriber_mdcn'), '') = '' then raise exception 'Enter the prescriber''s MDCN number'; end if;
  v_written := nullif(p->>'date_written', '')::date;
  if v_written is null then raise exception 'Enter the date the prescription was written'; end if;
  if v_written > current_date then raise exception 'The date written can''t be in the future'; end if;
  v_repeat := coalesce((p->>'is_repeat')::boolean, false);
  v_limit := case when v_repeat then v_p.rx_repeat_valid_days else v_p.rx_valid_days end;
  if v_written + v_limit < current_date then
    raise exception 'Written on %, which is past your % day limit for % prescriptions. Don''t dispense.',
      to_char(v_written, 'DD Mon YYYY'), v_limit, case when v_repeat then 'repeat' else 'new' end;
  end if;
  if not (coalesce((p->'checks'->>'signed_stamped')::boolean, false)
      and coalesce((p->'checks'->>'recent')::boolean, false)
      and coalesce((p->'checks'->>'dose_ok')::boolean, false)) then
    raise exception 'All three checks must be Yes before saving. If any is No, don''t dispense.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one medicine from the prescription';
  end if;

  insert into public.ph_prescriptions (pharmacy_id, patient_name, patient_age, patient_sex, patient_phone,
    prescriber_name, prescriber_mdcn, facility, date_written, is_repeat, photo_path, checks, notes, signed_by)
  values (v_ph, trim(p->>'patient_name'), nullif(p->>'patient_age', '')::int, nullif(p->>'patient_sex', ''),
    nullif(trim(p->>'patient_phone'), ''), trim(p->>'prescriber_name'), upper(trim(p->>'prescriber_mdcn')),
    nullif(trim(p->>'facility'), ''), v_written, v_repeat, nullif(p->>'photo_path', ''), p->'checks',
    nullif(trim(p->>'notes'), ''), p_signer)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_med from public.ph_medicines where id = (v_item->>'medicine_id')::uuid and pharmacy_id = v_ph;
    if v_med.id is null then raise exception 'Medicine not found'; end if;
    if coalesce((v_item->>'qty_prescribed')::numeric, 0) <= 0 then
      raise exception 'Enter how many % of % were prescribed', v_med.unit, v_med.name;
    end if;
    insert into public.ph_prescription_items (pharmacy_id, prescription_id, medicine_id, directions, qty_prescribed)
    values (v_ph, v_id, v_med.id, nullif(trim(v_item->>'directions'), ''), (v_item->>'qty_prescribed')::numeric)
    returning id into v_item_id;
    v_out := v_out || jsonb_build_object('id', v_item_id, 'medicine_id', v_med.id);
  end loop;

  return jsonb_build_object('id', v_id, 'items', v_out);
end $$;

-- ---------- checkout: one sale, batches picked first-expiry-first-out ----------
-- p_lines: [{ "medicine_id": uuid, "quantity": n, "prescription_item_id": uuid|null }]
create or replace function public.ph_checkout(
  p_lines jsonb, p_method public.ph_payment_method, p_ref text default null,
  p_tendered numeric default null, p_customer text default null, p_discount numeric default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ph uuid := public.ph_require();
  v_p public.ph_pharmacies; v_sale uuid; v_number bigint;
  v_line jsonb; v_med public.ph_medicines; v_qty numeric; v_need numeric; v_take numeric;
  v_rx record; v_rx_item uuid; v_batch record; v_sub numeric := 0; v_total numeric; v_change numeric;
begin
  select * into v_p from public.ph_pharmacies where id = v_ph;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'The cart is empty'; end if;

  perform pg_advisory_xact_lock(hashtext('ph_sale_' || v_ph::text));
  select coalesce(max(number), 0) + 1 into v_number from public.ph_sales where pharmacy_id = v_ph;

  insert into public.ph_sales (pharmacy_id, number, customer_name, payment_method, payment_ref)
  values (v_ph, v_number, nullif(trim(p_customer), ''), p_method, nullif(trim(p_ref), ''))
  returning id into v_sale;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_med from public.ph_medicines
     where id = (v_line->>'medicine_id')::uuid and pharmacy_id = v_ph and not archived;
    if v_med.id is null then raise exception 'A medicine in the cart was not found'; end if;
    v_qty := coalesce((v_line->>'quantity')::numeric, 0);
    if v_qty <= 0 then raise exception 'Quantity for % must be more than 0', v_med.name; end if;

    v_rx_item := nullif(v_line->>'prescription_item_id', '')::uuid;
    if v_med.class in ('pom','controlled') then
      if v_rx_item is null then
        raise exception '% is prescription-only. Record the prescription first.', v_med.name;
      end if;
      select pi.id, pi.medicine_id, pi.qty_prescribed - pi.qty_dispensed as remaining, pi.prescription_id,
             pr.date_written + case when pr.is_repeat then v_p.rx_repeat_valid_days else v_p.rx_valid_days end as valid_until
        into v_rx
        from public.ph_prescription_items pi
        join public.ph_prescriptions pr on pr.id = pi.prescription_id
       where pi.id = v_rx_item and pi.pharmacy_id = v_ph
       for update of pi;
      if v_rx.id is null or v_rx.medicine_id <> v_med.id then
        raise exception 'The prescription linked to % doesn''t match this medicine', v_med.name;
      end if;
      if v_rx.valid_until < current_date then
        raise exception 'The prescription for % is past its fill-by date (%)', v_med.name, to_char(v_rx.valid_until, 'DD Mon');
      end if;
      if v_rx.remaining < v_qty then
        raise exception 'The prescription allows % more % of %, not %', v_rx.remaining, v_med.unit, v_med.name, v_qty;
      end if;
      update public.ph_prescription_items set qty_dispensed = qty_dispensed + v_qty where id = v_rx_item;
    else
      v_rx_item := null;
    end if;

    v_need := v_qty;
    for v_batch in
      select id, quantity from public.ph_batches
       where medicine_id = v_med.id and status = 'available' and expiry_date >= current_date and quantity > 0
       order by expiry_date, received_date, created_at
       for update
    loop
      exit when v_need <= 0;
      v_take := least(v_need, v_batch.quantity);
      insert into public.ph_sale_items (pharmacy_id, sale_id, medicine_id, batch_id, quantity, unit_price, line_total, prescription_item_id)
      values (v_ph, v_sale, v_med.id, v_batch.id, v_take, v_med.sell_price, v_take * v_med.sell_price, v_rx_item);
      insert into public.ph_movements (pharmacy_id, medicine_id, batch_id, type, quantity_delta, reason, sale_id, prescription_id)
      values (v_ph, v_med.id, v_batch.id, 'sale', -v_take, 'Sale #' || v_number, v_sale,
              (select prescription_id from public.ph_prescription_items where id = v_rx_item));
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then
      raise exception 'Only % % of % in stock that can be sold', v_qty - v_need, v_med.unit, v_med.name;
    end if;
    v_sub := v_sub + v_qty * v_med.sell_price;
  end loop;

  if coalesce(p_discount, 0) < 0 or coalesce(p_discount, 0) > v_sub then raise exception 'Discount must be between 0 and the subtotal'; end if;
  v_total := v_sub - coalesce(p_discount, 0);
  if p_method = 'cash' then
    if coalesce(p_tendered, 0) < v_total then raise exception 'Cash given is less than the total'; end if;
    v_change := p_tendered - v_total;
  end if;

  update public.ph_sales
     set subtotal = v_sub, discount = coalesce(p_discount, 0), total = v_total,
         amount_tendered = case when p_method = 'cash' then p_tendered end, change_due = v_change
   where id = v_sale;

  return jsonb_build_object('sale_id', v_sale, 'number', v_number, 'total', v_total, 'change', v_change);
end $$;

-- ---------- void a sale (stock goes back to the same batches) ----------
create or replace function public.ph_void_sale(p_sale uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ph uuid := public.ph_require('admin','pharmacist'); v_s public.ph_sales; v_i record;
begin
  select * into v_s from public.ph_sales where id = p_sale and pharmacy_id = v_ph for update;
  if v_s.id is null then raise exception 'Sale not found'; end if;
  if v_s.status = 'void' then raise exception 'This sale is already void'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for voiding the sale'; end if;
  for v_i in select * from public.ph_sale_items where sale_id = p_sale loop
    insert into public.ph_movements (pharmacy_id, medicine_id, batch_id, type, quantity_delta, reason, sale_id)
    values (v_ph, v_i.medicine_id, v_i.batch_id, 'return', v_i.quantity, 'Void sale #' || v_s.number || ': ' || p_reason, p_sale);
    if v_i.prescription_item_id is not null then
      update public.ph_prescription_items set qty_dispensed = greatest(0, qty_dispensed - v_i.quantity)
       where id = v_i.prescription_item_id;
    end if;
  end loop;
  update public.ph_sales set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
   where id = p_sale;
end $$;

-- ---------- quarantine / release / dispose / count ----------
create or replace function public.ph_quarantine(p_batch uuid, p_reason public.ph_quarantine_reason, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_ph uuid := public.ph_require();
begin
  perform set_config('ph.rpc', 'on', true);
  update public.ph_batches
     set status = 'quarantine', quarantine_reason = p_reason, quarantine_note = nullif(trim(p_note), ''), quarantined_at = now()
   where id = p_batch and pharmacy_id = v_ph and status = 'available';
  if not found then raise exception 'Batch not found or not on the sales shelf'; end if;
end $$;

create or replace function public.ph_release(p_batch uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ph uuid := public.ph_require('admin','pharmacist'); v_b public.ph_batches;
begin
  select * into v_b from public.ph_batches where id = p_batch and pharmacy_id = v_ph;
  if v_b.id is null or v_b.status <> 'quarantine' then raise exception 'Batch is not in quarantine'; end if;
  if v_b.expiry_date < current_date then raise exception 'Expired stock can''t go back on the shelf'; end if;
  if exists (select 1 from public.ph_recalls r where r.medicine_id = v_b.medicine_id and r.status = 'open'
             and (r.batch_no is null or upper(r.batch_no) = v_b.batch_no)) then
    raise exception 'This batch is under an open recall';
  end if;
  perform set_config('ph.rpc', 'on', true);
  update public.ph_batches set status = 'available', quarantine_reason = null, quarantine_note = null, quarantined_at = null
   where id = p_batch;
end $$;

-- How: 'returned_to_supplier' | 'destroyed'
create or replace function public.ph_dispose(p_batch uuid, p_how text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_ph uuid := public.ph_require('admin','pharmacist'); v_b public.ph_batches;
begin
  select * into v_b from public.ph_batches where id = p_batch and pharmacy_id = v_ph for update;
  if v_b.id is null or v_b.status <> 'quarantine' then raise exception 'Move the batch to quarantine first'; end if;
  if p_how not in ('returned_to_supplier','destroyed') then raise exception 'Choose returned to supplier or destroyed'; end if;
  if v_b.quantity > 0 then
    insert into public.ph_movements (pharmacy_id, medicine_id, batch_id, type, quantity_delta, reason)
    values (v_ph, v_b.medicine_id, v_b.id, 'discard', -v_b.quantity,
            concat_ws(': ', case p_how when 'returned_to_supplier' then 'Returned to supplier' else 'Destroyed' end, nullif(trim(p_note), '')));
  end if;
  perform set_config('ph.rpc', 'on', true);
  update public.ph_batches set status = 'disposed', quarantine_note = concat_ws(' · ', quarantine_note, p_how) where id = p_batch;
end $$;

-- Shelf count: set a batch to what is physically there
create or replace function public.ph_adjust(p_batch uuid, p_counted numeric, p_reason text)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_ph uuid := public.ph_require('admin','pharmacist','inventory_officer'); v_b public.ph_batches; v_delta numeric;
begin
  select * into v_b from public.ph_batches where id = p_batch and pharmacy_id = v_ph;
  if v_b.id is null then raise exception 'Batch not found'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Enter what you counted'; end if;
  v_delta := p_counted - v_b.quantity;
  if v_delta <> 0 then
    if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the count is different'; end if;
    insert into public.ph_movements (pharmacy_id, medicine_id, batch_id, type, quantity_delta, reason)
    values (v_ph, v_b.medicine_id, v_b.id, 'adjust', v_delta, 'Count: ' || trim(p_reason));
  end if;
  return v_delta;
end $$;

-- Controlled drugs: compare the book with what is in the cabinet
create or replace function public.ph_controlled_count(p_medicine uuid, p_counted numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ph uuid := public.ph_require('admin','pharmacist'); v_book numeric; v_med public.ph_medicines;
begin
  select * into v_med from public.ph_medicines where id = p_medicine and pharmacy_id = v_ph;
  if v_med.id is null or v_med.class <> 'controlled' then raise exception 'Not a controlled medicine'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Enter what you counted'; end if;
  select coalesce(sum(quantity), 0) into v_book from public.ph_batches where medicine_id = p_medicine and status <> 'disposed';
  if p_counted <> v_book and coalesce(trim(p_note), '') = '' then
    raise exception 'The count doesn''t match the book (% in the book). Write down what you found.', v_book;
  end if;
  insert into public.ph_controlled_counts (pharmacy_id, medicine_id, book_qty, counted_qty, note)
  values (v_ph, p_medicine, v_book, p_counted, nullif(trim(p_note), ''));
  return jsonb_build_object('book', v_book, 'counted', p_counted, 'difference', p_counted - v_book);
end $$;

-- Recall: record it and pull matching batches off the shelf
create or replace function public.ph_create_recall(p_medicine uuid, p_batch_no text, p_reason text, p_reference text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_ph uuid := public.ph_require('admin','pharmacist'); v_n int;
begin
  if not exists (select 1 from public.ph_medicines where id = p_medicine and pharmacy_id = v_ph) then
    raise exception 'Medicine not found';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why it was recalled'; end if;
  insert into public.ph_recalls (pharmacy_id, medicine_id, batch_no, reason, reference)
  values (v_ph, p_medicine, nullif(upper(trim(p_batch_no)), ''), trim(p_reason), nullif(trim(p_reference), ''));
  perform set_config('ph.rpc', 'on', true);
  update public.ph_batches
     set status = 'quarantine', quarantine_reason = 'recalled', quarantine_note = trim(p_reason), quarantined_at = now()
   where medicine_id = p_medicine and pharmacy_id = v_ph and status = 'available'
     and (nullif(trim(p_batch_no), '') is null or batch_no = upper(trim(p_batch_no)));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------- nightly: expired stock leaves the shelf by itself ----------
create or replace function public.ph_daily_jobs()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('ph.rpc', 'on', true);
  update public.ph_batches
     set status = 'quarantine', quarantine_reason = 'expired', quarantined_at = now()
   where status = 'available' and expiry_date < current_date and quantity > 0;
end $$;

-- ---------- permissions ----------
revoke execute on function
  public.ph_touch_updated_at(), public.ph_guard_staff(), public.ph_guard_medicine(), public.ph_guard_batch(),
  public.ph_apply_movement(), public.ph_check_temperature(), public.ph_audit(),
  public.ph_check_pin(uuid, text), public.ph_daily_jobs()
  from public, anon, authenticated;

revoke execute on function
  public.ph_my_pharmacy(), public.ph_my_role(), public.ph_has_role(variadic public.ph_role[]),
  public.ph_require(variadic public.ph_role[]),
  public.ph_set_pin(text), public.ph_has_pin(),
  public.ph_receive(uuid, text, date, numeric, uuid, uuid, numeric, jsonb, public.ph_quarantine_reason, text, boolean),
  public.ph_create_prescription(jsonb, jsonb, uuid, text),
  public.ph_checkout(jsonb, public.ph_payment_method, text, numeric, text, numeric),
  public.ph_void_sale(uuid, text), public.ph_quarantine(uuid, public.ph_quarantine_reason, text),
  public.ph_release(uuid), public.ph_dispose(uuid, text, text), public.ph_adjust(uuid, numeric, text),
  public.ph_controlled_count(uuid, numeric, text), public.ph_create_recall(uuid, text, text, text)
  from public, anon;

grant execute on function
  public.ph_my_pharmacy(), public.ph_my_role(), public.ph_has_role(variadic public.ph_role[]),
  public.ph_require(variadic public.ph_role[]),
  public.ph_set_pin(text), public.ph_has_pin(),
  public.ph_receive(uuid, text, date, numeric, uuid, uuid, numeric, jsonb, public.ph_quarantine_reason, text, boolean),
  public.ph_create_prescription(jsonb, jsonb, uuid, text),
  public.ph_checkout(jsonb, public.ph_payment_method, text, numeric, text, numeric),
  public.ph_void_sale(uuid, text), public.ph_quarantine(uuid, public.ph_quarantine_reason, text),
  public.ph_release(uuid), public.ph_dispose(uuid, text, text), public.ph_adjust(uuid, numeric, text),
  public.ph_controlled_count(uuid, numeric, text), public.ph_create_recall(uuid, text, text, text)
  to authenticated;
