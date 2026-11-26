let tz = 'Africa/Lagos'
export const setTimezone = (t: string) => { tz = t }

const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2, minimumFractionDigits: 0 })
export const money = (n: number | null | undefined) => naira.format(Number(n ?? 0)).replace('NGN', '₦')
export const num = (n: number | null | undefined) => new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format(Number(n ?? 0))

/** Today as YYYY-MM-DD in the pharmacy's time zone. */
export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const a = Date.parse(todayISO() + 'T00:00:00Z'); const b = Date.parse(iso.slice(0, 10) + 'T00:00:00Z')
  return Math.round((b - a) / 86_400_000)
}
export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '—'
  const d = iso.length === 10 ? new Date(iso + 'T12:00:00Z') : new Date(iso)
  return new Intl.DateTimeFormat('en-GB', { timeZone: iso.length === 10 ? 'UTC' : tz, ...opts }).format(d)
}
export const fmtShort = (iso: string | null | undefined) => fmtDate(iso, { day: 'numeric', month: 'short' })
export function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}
export function fmtWhen(iso: string | null | undefined) {
  if (!iso) return '—'
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso))
  return day === todayISO() ? `Today ${fmtTime(iso)}` : `${fmtShort(iso)} ${fmtTime(iso)}`
}
/** Start of today in the pharmacy's zone, as an ISO timestamp for queries. */
export function startOfTodayISO(): string {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return new Date(now.getTime() - ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 - now.getMilliseconds()).toISOString()
}

/** Plain words for time left until expiry, as printed on the shelf-label stub. */
export function stubFor(daysLeft: number | null, warnDays: number): { cls: 'ok' | 'soon' | 'warn' | 'bad' | 'q'; big: string; small: string } {
  if (daysLeft == null) return { cls: 'ok', big: '—', small: 'no date' }
  if (daysLeft < 0) return { cls: 'bad', big: String(-daysLeft), small: daysLeft === -1 ? 'day ago' : 'days ago' }
  if (daysLeft <= 30) return { cls: 'bad', big: String(daysLeft), small: daysLeft === 1 ? 'day left' : 'days left' }
  if (daysLeft <= warnDays) return { cls: 'warn', big: String(daysLeft), small: 'days left' }
  if (daysLeft <= 180) return { cls: 'soon', big: String(Math.round(daysLeft / 30)), small: 'months' }
  return { cls: 'ok', big: daysLeft > 730 ? `${Math.round(daysLeft / 365)}y` : String(Math.round(daysLeft / 30)), small: daysLeft > 730 ? 'years' : 'months' }
}

export const CLASS_LABEL = { otc: 'Over the counter', pom: 'Prescription only', controlled: 'Controlled' } as const
export const CLASS_SHORT = { otc: 'OTC', pom: 'Rx only', controlled: 'Controlled' } as const
export const ROLE_LABEL = { admin: 'Superintendent pharmacist', pharmacist: 'Pharmacist', inventory_officer: 'Inventory officer', sales: 'Sales / cashier' } as const
export const VEN_LABEL = { vital: 'Vital', essential: 'Essential', non_essential: 'Non-essential' } as const
export const REASON_LABEL = {
  expired: 'Expired', damaged: 'Damaged or broken', recalled: 'Recalled', returned: 'Returned by a customer',
  suspect: 'Looks fake or tampered', failed_check: 'Failed a receiving check', other: 'Other',
} as const
export const PAY_LABEL = { cash: 'Cash', card: 'Card (POS)', transfer: 'Bank transfer', ussd: 'USSD' } as const

export const medLabel = (m: { name: string; strength?: string | null; form?: string | null }) =>
  [m.name, m.strength, m.form].filter(Boolean).join(' ')

/** How long a prescription can be filled for, given the pharmacy's rules. */
export function rxValidUntil(dateWritten: string, isRepeat: boolean, p: { rx_valid_days: number; rx_repeat_valid_days: number }) {
  return addDays(dateWritten, isRepeat ? p.rx_repeat_valid_days : p.rx_valid_days)
}
