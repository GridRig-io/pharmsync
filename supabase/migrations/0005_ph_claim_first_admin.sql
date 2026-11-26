-- =====================================================================
-- PharmSync · 0005 first admin
-- While a pharmacy has no staff at all, the first signed-in user who opens
-- PharmSync can claim it as its admin. Once anyone is on the staff list this
-- does nothing; after that the admin adds everyone from Settings → Staff.
-- =====================================================================
create or replace function public.ph_claim_pharmacy()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_ph uuid; v_name text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.ph_staff where id = auth.uid()) then
    return (select pharmacy_id from public.ph_staff where id = auth.uid());
  end if;
  perform pg_advisory_xact_lock(hashtext('ph_claim'));
  select id into v_ph from public.ph_pharmacies p
   where not exists (select 1 from public.ph_staff s where s.pharmacy_id = p.id)
   order by created_at limit 1;
  if v_ph is null then
    raise exception 'This pharmacy already has an admin. Ask them to add you from Settings → Staff.';
  end if;
  select coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1)) into v_name from auth.users where id = auth.uid();
  insert into public.ph_staff (id, pharmacy_id, full_name, email, role)
  values (auth.uid(), v_ph, v_name, (select email from auth.users where id = auth.uid()), 'admin');
  return v_ph;
end $$;

create or replace function public.ph_can_claim()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ph_pharmacies p where not exists (select 1 from public.ph_staff s where s.pharmacy_id = p.id))
$$;

revoke execute on function public.ph_claim_pharmacy(), public.ph_can_claim() from public, anon;
grant execute on function public.ph_claim_pharmacy(), public.ph_can_claim() to authenticated;
