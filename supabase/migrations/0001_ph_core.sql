-- =====================================================================
-- PharmSync · 0001 core tables
--
-- PharmSync shares a Supabase project with LabSync. To keep the two apps
-- apart, every PharmSync object is prefixed `ph_` and PharmSync never
-- reads or writes LabSync tables. Staff membership lives in ph_staff
-- (not LabSync's profiles), so a login can belong to either app or both.
--
-- Multi-pharmacy ready: every row carries pharmacy_id and RLS isolates
-- pharmacies.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;

-- ---------- enums ----------
create type public.ph_role              as enum ('admin','pharmacist','inventory_officer','sales');
create type public.ph_med_class         as enum ('otc','pom','controlled');
create type public.ph_ven               as enum ('vital','essential','non_essential');
create type public.ph_batch_status      as enum ('available','quarantine','disposed');
create type public.ph_quarantine_reason as enum ('expired','damaged','recalled','returned','suspect','failed_check','other');
create type public.ph_movement_type     as enum ('receive','sale','return','adjust','discard');
create type public.ph_payment_method    as enum ('cash','card','transfer','ussd');

-- ---------- pharmacies ----------
create table public.ph_pharmacies (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null default 'My Pharmacy',
  short_code             text,
  address                text,
  phone                  text,
  pcn_premises_no        text,                 -- PCN premises registration number, printed on receipts
  timezone               text not null default 'Africa/Lagos',
  currency               text not null default 'NGN',
  -- house rules (editable in Settings)
  min_shelf_life_days    int  not null default 180 check (min_shelf_life_days between 0 and 1095),  -- refuse deliveries with less left
  expiry_warning_days    int  not null default 90  check (expiry_warning_days between 7 and 365),
  rx_valid_days          int  not null default 7   check (rx_valid_days between 1 and 365),         -- a prescription can be filled within N days of being written
  rx_repeat_valid_days   int  not null default 30  check (rx_repeat_valid_days between 1 and 365),  -- repeat prescriptions
  fridge_min_c           numeric not null default 2,
  fridge_max_c           numeric not null default 8,
  room_max_c             numeric not null default 25,
  receipt_footer         text default 'Thank you. Keep medicines out of reach of children.',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table public.ph_staff (
  id           uuid primary key references auth.users(id) on delete cascade,
  pharmacy_id  uuid not null references public.ph_pharmacies(id) on delete cascade,
  full_name    text,
  email        text,
  role         public.ph_role not null default 'sales',
  pcn_reg_no   text,                         -- pharmacists' PCN registration number
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.ph_staff (pharmacy_id);

-- PINs used to sign prescriptions and controlled-drug entries.
-- Separate table with no policies: only security-definer functions touch it.
create table public.ph_staff_pins (
  staff_id   uuid primary key references public.ph_staff(id) on delete cascade,
  pin_hash   text not null,
  updated_at timestamptz not null default now()
);

-- ---------- role helpers ----------
create or replace function public.ph_my_pharmacy()
returns uuid language sql stable security definer set search_path = public as $$
  select pharmacy_id from public.ph_staff where id = auth.uid() and is_active
$$;

create or replace function public.ph_my_role()
returns public.ph_role language sql stable security definer set search_path = public as $$
  select role from public.ph_staff where id = auth.uid() and is_active
$$;

create or replace function public.ph_has_role(variadic roles public.ph_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.ph_my_role() = any(roles), false)
$$;

-- ---------- reference lists ----------
create table public.ph_shelves (
  id           uuid primary key default gen_random_uuid(),
  pharmacy_id  uuid not null default public.ph_my_pharmacy() references public.ph_pharmacies(id) on delete cascade,
  name         text not null,
  kind         text not null default 'shelf' check (kind in ('shelf','fridge','store','locked_cabinet','quarantine')),
  unique (pharmacy_id, name)
);

create table public.ph_suppliers (
  id                 uuid primary key default gen_random_uuid(),
  pharmacy_id        uuid not null default public.ph_my_pharmacy() references public.ph_pharmacies(id) on delete cascade,
  name               text not null,
  phone              text,
  email              text,
  accepts_returns    boolean not null default true,
  return_window_days int,                         -- takes back short-dated stock up to N days before expiry
  notes              text,
  unique (pharmacy_id, name)
);

-- ---------- medicines ----------
create table public.ph_medicines (
  id                  uuid primary key default gen_random_uuid(),
  pharmacy_id         uuid not null default public.ph_my_pharmacy() references public.ph_pharmacies(id) on delete cascade,
  name                text not null,                 -- generic name, e.g. Amoxicillin
  strength            text,                          -- 500 mg
  form                text,                          -- capsules, tablets, syrup, injection
  brand               text,
  unit                text not null default 'box',   -- what is counted and sold: box, strip, bottle, ampoule
  units_per_pack      int check (units_per_pack > 0),-- e.g. 10 capsules in a box (information)
  barcode             text,
  nafdac_no           text,
  greenbook_verified  boolean not null default false,
  class               public.ph_med_class not null default 'otc',
  ven                 public.ph_ven not null default 'essential',
  lasa_note           text,                          -- look-alike / sound-alike warning
  reorder_level       numeric not null default 0 check (reorder_level >= 0),
  max_level           numeric check (max_level >= 0),
  sell_price          numeric not null default 0 check (sell_price >= 0),
  cost_price          numeric check (cost_price >= 0),
  default_shelf_id    uuid references public.ph_shelves(id) on delete set null,
  cold_chain          boolean not null default false,
  notes               text,
  archived            boolean not null default false,
  created_by          uuid references auth.users(id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (pharmacy_id, barcode)
);
create index on public.ph_medicines (pharmacy_id, name);

create table public.ph_batches (
  id                 uuid primary key default gen_random_uuid(),
  pharmacy_id        uuid not null default public.ph_my_pharmacy() references public.ph_pharmacies(id) on delete cascade,
  medicine_id        uuid not null references public.ph_medicines(id) on delete cascade,
  batch_no           text not null,
  expiry_date        date not null,
  received_date      date not null default current_date,
  supplier_id        uuid references public.ph_suppliers(id) on delete set null,
  shelf_id           uuid references public.ph_shelves(id) on delete set null,
  cost_price         numeric check (cost_price >= 0),
  status             public.ph_batch_status not null default 'available',
  quarantine_reason  public.ph_quarantine_reason,
  quarantine_note    text,
  quarantined_at     timestamptz,
  quantity           numeric not null default 0 check (quantity >= 0),   -- maintained by the movement trigger only
  receive_checks     jsonb,                                              -- answers given at receiving
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on public.ph_batches (medicine_id);
create index on public.ph_batches (pharmacy_id, expiry_date) where quantity > 0;

-- ---------- sales ----------
create table public.ph_sales (
  id               uuid primary key default gen_random_uuid(),
  pharmacy_id      uuid not null references public.ph_pharmacies(id) on delete cascade,
  number           bigint not null,                     -- per-pharmacy receipt number
  customer_name    text,
  status           text not null default 'paid' check (status in ('paid','void')),
  subtotal         numeric not null default 0,
  discount         numeric not null default 0 check (discount >= 0),
  total            numeric not null default 0,
  payment_method   public.ph_payment_method not null,
  payment_ref      text,                                -- terminal / transfer reference (terminal integration later)
  amount_tendered  numeric,
  change_due       numeric,
  cashier_id       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  voided_at        timestamptz,
  voided_by        uuid references auth.users(id) on delete set null,
  void_reason      text,
  unique (pharmacy_id, number)
);
create index on public.ph_sales (pharmacy_id, created_at desc);

-- ---------- prescriptions ----------
create table public.ph_prescriptions (
  id               uuid primary key default gen_random_uuid(),
  pharmacy_id      uuid not null references public.ph_pharmacies(id) on delete cascade,
  patient_name     text not null,
  patient_age      int check (patient_age between 0 and 130),
  patient_sex      text check (patient_sex in ('female','male')),
  patient_phone    text,
  prescriber_name  text not null,
  prescriber_mdcn  text not null,                       -- MDCN registration number
  facility         text,
  date_written     date not null,
  is_repeat        boolean not null default false,
  photo_path       text,                                -- in the ph-prescriptions storage bucket
  checks           jsonb not null default '{}',         -- {signed_stamped, recent, dose_ok}
  notes            text,
  signed_by        uuid not null references public.ph_staff(id),
  signed_at        timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now()
);
create index on public.ph_prescriptions (pharmacy_id, created_at desc);
create index on public.ph_prescriptions (pharmacy_id, lower(patient_name));

create table public.ph_prescription_items (
  id               uuid primary key default gen_random_uuid(),
  pharmacy_id      uuid not null references public.ph_pharmacies(id) on delete cascade,
  prescription_id  uuid not null references public.ph_prescriptions(id) on delete cascade,
  medicine_id      uuid not null references public.ph_medicines(id),
  directions       text,
  qty_prescribed   numeric not null check (qty_prescribed > 0),   -- in the medicine's selling unit
  qty_dispensed    numeric not null default 0 check (qty_dispensed >= 0),
  check (qty_dispensed <= qty_prescribed)
);
create index on public.ph_prescription_items (prescription_id);

create table public.ph_sale_items (
  id                    uuid primary key default gen_random_uuid(),
  pharmacy_id           uuid not null references public.ph_pharmacies(id) on delete cascade,
  sale_id               uuid not null references public.ph_sales(id) on delete cascade,
  medicine_id           uuid not null references public.ph_medicines(id),
  batch_id              uuid not null references public.ph_batches(id),
  quantity              numeric not null check (quantity > 0),
  unit_price            numeric not null,
  line_total            numeric not null,
  prescription_item_id  uuid references public.ph_prescription_items(id)
);
create index on public.ph_sale_items (sale_id);

-- ---------- stock movements (the only way quantities change) ----------
create table public.ph_movements (
  id               uuid primary key default gen_random_uuid(),
  pharmacy_id      uuid not null references public.ph_pharmacies(id) on delete cascade,
  medicine_id      uuid not null references public.ph_medicines(id) on delete cascade,
  batch_id         uuid not null references public.ph_batches(id) on delete cascade,
  type             public.ph_movement_type not null,
  quantity_delta   numeric not null check (quantity_delta <> 0),
  reason           text,
  sale_id          uuid references public.ph_sales(id) on delete set null,
  prescription_id  uuid references public.ph_prescriptions(id) on delete set null,
  balance_after    numeric,                             -- medicine total on hand after this movement (running balance)
  performed_by     uuid references auth.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now()
);
create index on public.ph_movements (medicine_id, created_at desc);
create index on public.ph_movements (pharmacy_id, created_at desc);

-- ---------- registers & logs ----------
create table public.ph_controlled_counts (
  id           uuid primary key default gen_random_uuid(),
  pharmacy_id  uuid not null references public.ph_pharmacies(id) on delete cascade,
  medicine_id  uuid not null references public.ph_medicines(id) on delete cascade,
  book_qty     numeric not null,
  counted_qty  numeric not null check (counted_qty >= 0),
  note         text,
  counted_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index on public.ph_controlled_counts (medicine_id, created_at desc);

create table public.ph_temperature_logs (
  id            uuid primary key default gen_random_uuid(),
  pharmacy_id   uuid not null default public.ph_my_pharmacy() references public.ph_pharmacies(id) on delete cascade,
  kind          text not null check (kind in ('fridge','room')),
  shelf_id      uuid references public.ph_shelves(id) on delete set null,
  reading_c     numeric not null check (reading_c between -40 and 60),
  out_of_range  boolean not null default false,          -- set by trigger
  action_taken  text,
  recorded_by   uuid references auth.users(id) on delete set null default auth.uid(),
  recorded_at   timestamptz not null default now()
);
create index on public.ph_temperature_logs (pharmacy_id, recorded_at desc);

create table public.ph_recalls (
  id           uuid primary key default gen_random_uuid(),
  pharmacy_id  uuid not null references public.ph_pharmacies(id) on delete cascade,
  medicine_id  uuid not null references public.ph_medicines(id) on delete cascade,
  batch_no     text,                                     -- null = every batch of the medicine
  reason       text not null,
  reference    text,                                     -- NAFDAC or manufacturer notice
  status       text not null default 'open' check (status in ('open','closed')),
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  closed_at    timestamptz
);

-- Opening checks: one row per pharmacy, day and check
create table public.ph_daily_checks (
  pharmacy_id  uuid not null default public.ph_my_pharmacy() references public.ph_pharmacies(id) on delete cascade,
  day          date not null,
  check_key    text not null check (check_key in ('fridge','room','controlled','quarantine','expiry')),
  done_by      uuid references auth.users(id) on delete set null default auth.uid(),
  done_at      timestamptz not null default now(),
  note         text,
  primary key (pharmacy_id, day, check_key)
);

create table public.ph_audit_log (
  id           bigserial primary key,
  pharmacy_id  uuid,
  table_name   text not null,
  record_id    text,
  action       text not null,
  actor_id     uuid,
  old_data     jsonb,
  new_data     jsonb,
  created_at   timestamptz not null default now()
);
create index on public.ph_audit_log (pharmacy_id, created_at desc);
