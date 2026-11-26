-- PharmSync end-to-end database test.
-- One DO block: it creates a throwaway pharmacist, runs the whole flow as that
-- signed-in user, then raises an exception carrying the results, so EVERYTHING
-- is rolled back. Read the results in the error message.
create or replace function pg_temp.fmt(t text, ok boolean, d text default null) returns text language sql as $f$
  select case when ok then 'PASS  ' else 'FAIL  ' end || t || coalesce('  — ' || d, '') || E'\n'
$f$;

do $$
declare
  r text := E'\n';
  v_otc uuid; v_pom uuid; v_b1 uuid; v_b2 uuid; v_rx jsonb; v_item uuid; v_sale jsonb; v_err text; v_n numeric;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ph-test-admin@example.invalid');
  insert into public.ph_staff (id, pharmacy_id, full_name, email, role)
  values ('00000000-0000-4000-8000-0000000000a1', (select id from public.ph_pharmacies order by created_at limit 1), 'Test Pharmacist', 'ph-test-admin@example.invalid', 'admin');
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
  execute 'set local role authenticated';
  insert into public.ph_medicines (name, strength, unit, class, sell_price, reorder_level)
  values ('TEST Paracetamol', '500 mg', 'box', 'otc', 600, 5) returning id into v_otc;
  insert into public.ph_medicines (name, strength, unit, class, sell_price)
  values ('TEST Amoxicillin', '500 mg', 'box', 'pom', 3800) returning id into v_pom;
  r := r || pg_temp.fmt('admin can add OTC and POM medicines', true);

  -- receive: two batches of amoxicillin, later-expiring first
  v_b2 := public.ph_receive(v_pom, 'amx-late', current_date + 400, 10);
  v_b1 := public.ph_receive(v_pom, 'amx-early', current_date + 200, 3);
  perform public.ph_receive(v_otc, 'pcm-1', current_date + 500, 20);
  r := r || pg_temp.fmt('receive sets stock through movements',
    (select quantity from public.ph_batches where id = v_b1) = 3, 'batch numbers uppercased: ' || (select batch_no from public.ph_batches where id = v_b1));

  begin
    perform public.ph_receive(v_otc, 'short', current_date + 30, 5);
    r := r || pg_temp.fmt('short-dated delivery refused', false, 'was accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    r := r || pg_temp.fmt('short-dated delivery refused', true, v_err);
  end;

  begin
    update public.ph_batches set quantity = 999 where id = v_b1;
    r := r || pg_temp.fmt('direct quantity edit blocked', false, 'was allowed');
  exception when others then
    get stacked diagnostics v_err = message_text;
    r := r || pg_temp.fmt('direct quantity edit blocked', true, v_err);
  end;

  -- POM without a prescription
  begin
    perform public.ph_checkout(jsonb_build_array(jsonb_build_object('medicine_id', v_pom, 'quantity', 1)), 'cash', null, 10000);
    r := r || pg_temp.fmt('POM sale without prescription blocked', false, 'was sold');
  exception when others then
    get stacked diagnostics v_err = message_text;
    r := r || pg_temp.fmt('POM sale without prescription blocked', true, v_err);
  end;

  -- prescription: wrong PIN, stale date, then valid
  perform public.ph_set_pin('2468');
  begin
    perform public.ph_create_prescription(jsonb_build_object('patient_name','T Patient','prescriber_name','Dr T','prescriber_mdcn','mdcn/1',
      'date_written', current_date, 'checks', jsonb_build_object('signed_stamped',true,'recent',true,'dose_ok',true)),
      jsonb_build_array(jsonb_build_object('medicine_id', v_pom, 'qty_prescribed', 4)), auth.uid(), '0000');
    r := r || pg_temp.fmt('wrong PIN rejected', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    r := r || pg_temp.fmt('wrong PIN rejected', true, v_err);
  end;
  begin
    perform public.ph_create_prescription(jsonb_build_object('patient_name','T Patient','prescriber_name','Dr T','prescriber_mdcn','mdcn/1',
      'date_written', current_date - 10, 'checks', jsonb_build_object('signed_stamped',true,'recent',true,'dose_ok',true)),
      jsonb_build_array(jsonb_build_object('medicine_id', v_pom, 'qty_prescribed', 4)), auth.uid(), '2468');
    r := r || pg_temp.fmt('10-day-old new prescription rejected (7-day rule)', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    r := r || pg_temp.fmt('10-day-old new prescription rejected (7-day rule)', true, v_err);
  end;
  v_rx := public.ph_create_prescription(jsonb_build_object('patient_name','T Patient','prescriber_name','Dr T','prescriber_mdcn','mdcn/1',
      'date_written', current_date - 10, 'is_repeat', true, 'checks', jsonb_build_object('signed_stamped',true,'recent',true,'dose_ok',true)),
      jsonb_build_array(jsonb_build_object('medicine_id', v_pom, 'qty_prescribed', 4, 'directions', '1 cap 4x daily')), auth.uid(), '2468');
  v_item := (v_rx->'items'->0->>'id')::uuid;
  r := r || pg_temp.fmt('10-day-old repeat prescription accepted (30-day rule)', v_item is not null, null);

  -- over the prescription
  begin
    perform public.ph_checkout(jsonb_build_array(jsonb_build_object('medicine_id', v_pom, 'quantity', 5, 'prescription_item_id', v_item)), 'card');
    r := r || pg_temp.fmt('selling more than prescribed blocked', false, 'sold');
  exception when others then
    get stacked diagnostics v_err = message_text;
    r := r || pg_temp.fmt('selling more than prescribed blocked', true, v_err);
  end;

  -- valid sale: 4 amox (3 from early batch + 1 from late) + 2 paracetamol, cash
  v_sale := public.ph_checkout(jsonb_build_array(
      jsonb_build_object('medicine_id', v_pom, 'quantity', 4, 'prescription_item_id', v_item),
      jsonb_build_object('medicine_id', v_otc, 'quantity', 2)), 'cash', null, 20000, 'Walk-in');
  r := r || pg_temp.fmt('checkout total correct', (v_sale->>'total')::numeric = 4*3800 + 2*600,
    'total ' || (v_sale->>'total') || ', change ' || (v_sale->>'change'));
  r := r || pg_temp.fmt('FEFO: early batch emptied first',
    (select quantity from public.ph_batches where id = v_b1) = 0 and (select quantity from public.ph_batches where id = v_b2) = 9,
    'early ' || (select quantity from public.ph_batches where id = v_b1) || ', late ' || (select quantity from public.ph_batches where id = v_b2));
  r := r || pg_temp.fmt('prescription marked dispensed',
    (select qty_dispensed from public.ph_prescription_items where id = v_item) = 4, null);

  -- void returns stock
  perform public.ph_void_sale((v_sale->>'sale_id')::uuid, 'test');
  r := r || pg_temp.fmt('void returns stock and frees the prescription',
    (select quantity from public.ph_batches where id = v_b1) = 3 and (select qty_dispensed from public.ph_prescription_items where id = v_item) = 0, null);

  -- recall pulls batch
  perform public.ph_create_recall(v_pom, 'AMX-LATE', 'Test recall');
  r := r || pg_temp.fmt('recall moves the batch to quarantine',
    (select status from public.ph_batches where id = v_b2) = 'quarantine', null);
  begin
    perform public.ph_release(v_b2);
    r := r || pg_temp.fmt('recalled batch cannot be released', false, 'released');
  exception when others then
    get stacked diagnostics v_err = message_text;
    r := r || pg_temp.fmt('recalled batch cannot be released', true, v_err);
  end;

  -- temperature out of range needs an action
  begin
    insert into public.ph_temperature_logs (kind, reading_c) values ('fridge', 11);
    r := r || pg_temp.fmt('out-of-range fridge needs action', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    r := r || pg_temp.fmt('out-of-range fridge needs action', true, v_err);
  end;
  select count(*) into v_n from public.ph_stock where name like 'TEST %';
  r := r || pg_temp.fmt('stock view readable', v_n = 2, v_n::text);
  execute 'reset role';
  raise exception 'TEST RESULTS (all rolled back):%', r;
end $$;
