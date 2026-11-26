-- =====================================================================
-- PharmSync · 0004 storage, nightly job, realtime, starter data
-- =====================================================================

-- Prescription photos: private bucket, one folder per pharmacy
insert into storage.buckets (id, name, public) values ('ph-prescriptions', 'ph-prescriptions', false)
on conflict (id) do nothing;

create policy "ph prescriptions read" on storage.objects for select to authenticated
  using (bucket_id = 'ph-prescriptions' and (storage.foldername(name))[1] = public.ph_my_pharmacy()::text);
create policy "ph prescriptions upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'ph-prescriptions' and (storage.foldername(name))[1] = public.ph_my_pharmacy()::text);

-- 00:05 Lagos time: expired stock moves to quarantine
select cron.schedule('ph-daily', '5 23 * * *', $$select public.ph_daily_jobs()$$);

-- Live updates for the till, expiry board and home screen
alter publication supabase_realtime add table public.ph_batches, public.ph_sales, public.ph_recalls;

-- ---------- starter data ----------
-- One pharmacy with shelves. Medicines are added in the app.
with ph as (
  insert into public.ph_pharmacies (name, short_code) values ('PharmSync Test Pharmacy', 'PST') returning id
)
insert into public.ph_shelves (pharmacy_id, name, kind)
select ph.id, s.name, s.kind from ph,
  (values ('Shelf A','shelf'), ('Shelf B','shelf'), ('Shelf C','shelf'), ('Shelf D','shelf'),
          ('Shelf E','shelf'), ('Shelf F','shelf'), ('Fridge 1','fridge'), ('Locked cabinet','locked_cabinet'),
          ('Store room','store'), ('Quarantine shelf','quarantine')) as s(name, kind);
