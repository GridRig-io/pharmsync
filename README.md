# PharmSync

Pharmacy stock, expiry, prescriptions and till, built for someone on their first day. It's an installable web app (PWA): a phone or tablet at the counter, a laptop in the office.

**Stack:** React + Vite + TypeScript · Supabase (Postgres, Auth, Realtime, Storage, Edge Functions, pg_cron) · Vercel. Same stack and Supabase project as LabSync; every PharmSync table, view and function starts with `ph_`, so the two apps never touch each other's data.

## Design: "Shelf Label"

Calm pine and white, Atkinson Hyperlegible type (made for easy reading). **One lime highlight per screen, and it always means "do this next".** Colour always comes with a word and a number. Batches are shown as shelf labels: the stub on the left says how long is left before expiry.

## What it does

- **Home**: today's opening checks (fridge and room temperature, locked-cabinet count, quarantine shelf, short-dated stock), a "Next step" bar, and a "Needs you" list (recalls, expired stock on the shelf, short-dated batches, low stock, items on hold).
- **Sell (till)**: scan with a USB/Bluetooth scanner or the phone camera, cart, discount, cash with change, card/transfer/USSD with a reference, 80 mm receipt printing, void with reason. Batches are taken oldest-expiry-first automatically.
- **Prescription lock**: Rx-only and controlled medicines can't be sold until a prescription is recorded: patient, prescriber and MDCN number, photo of the paper, three pharmacist checks, and the pharmacist's PIN. New prescriptions can be filled within **7 days** of being written, repeats within **30 days** (both editable in Settings). The quantity sold can't go over what was prescribed. Saved prescriptions can be reused for repeats.
- **Prescription-only list**: the superintendent pharmacist decides which medicines are OTC, Rx only or Controlled.
- **Receive delivery**: 4 steps. Find the medicine, Yes/No checks (sealed, matches invoice, NAFDAC number, looks genuine, arrived cold), batch/expiry/quantity, shelf. Any "No" sends it to quarantine. Deliveries with less than 180 days of shelf life are refused unless a pharmacist accepts them.
- **Expiry & quarantine**: expiry ladder (expired / 30 days / 90 days / 6 months), supplier return windows, and the quarantine shelf with release, return to supplier or destroy.
- **Controlled register**: every movement with a running balance, plus a daily count that must match the book.
- **Recalls**: record a NAFDAC or manufacturer recall and every matching batch is taken off sale at once.
- **Temperature log** with out-of-range readings that require the action taken.
- **Staff and roles**: superintendent pharmacist (admin), pharmacist, inventory officer, sales. People who already use LabSync are added with the same login.

All the rules (prescription lock, FEFO, quantity limits, validity windows, shelf-life rule, PIN check, recall quarantine) are enforced in the database, not just the screen.

## Payment terminal

Left open on purpose. Today card, transfer and USSD are recorded by typing the reference from the POS slip or bank alert. `src/lib/payments.ts` has a provider slot ready for a terminal integration (e.g. Moniepoint or Paystack Terminal) once one is chosen.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Database: apply `supabase/migrations/0001…0005` in order (already applied on the shared project). `supabase/tests/ph_flow_test.sql` runs the end-to-end rules test and rolls everything back.
4. Edge function: `supabase/functions/ph-manage-staff` (deployed).
5. `npm run dev`

**First sign-in:** the first person to sign in to a pharmacy with no staff gets a "Make me the admin" button. After that, the admin adds everyone from Settings → Staff.

---

Made by Clanker.
