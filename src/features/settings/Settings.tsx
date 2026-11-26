import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, KeyRound, Trash2, UserPlus, Store, Users, Rows3, Truck, Type } from 'lucide-react'
import { supabase, rpc, friendlyError } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useShelves, useStaffList, useSuppliers } from '../../lib/data'
import { useToast } from '../../lib/toast'
import { ROLE_LABEL } from '../../lib/format'
import type { Role, Shelf, Staff, Supplier } from '../../lib/types'
import { Avatar, Chips, Field, Note, PageHead, Seg, Sheet, Switch, Tag } from '../../components/ui'
import { Clanker } from '../../components/Clanker'

type Tab = 'pharmacy' | 'staff' | 'shelves' | 'suppliers' | 'pin' | 'display'

export default function Settings() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) ?? 'pin'
  const { can } = useSession()
  const tabs: { value: Tab; label: string; show?: boolean }[] = [
    { value: 'pin', label: 'My PIN' },
    { value: 'pharmacy', label: 'Pharmacy rules' },
    { value: 'staff', label: 'Staff' },
    { value: 'shelves', label: 'Shelves' },
    { value: 'suppliers', label: 'Suppliers' },
    { value: 'display', label: 'Display' },
  ]
  return (
    <div className="page stack" style={{ maxWidth: 820 }}>
      <PageHead title="Settings" />
      <Chips value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} options={tabs.filter((t) => t.show !== false)} />
      {tab === 'pharmacy' && <PharmacyRules />}
      {tab === 'staff' && <StaffTab />}
      {tab === 'shelves' && <ShelvesTab editable={can('stock.write')} />}
      {tab === 'suppliers' && <SuppliersTab editable={can('stock.write')} />}
      {tab === 'pin' && <PinTab />}
      {tab === 'display' && <DisplayTab />}
      <div style={{ textAlign: 'center', marginTop: 24 }}><Clanker /></div>
    </div>
  )
}

/* ---------- pharmacy rules ---------- */
function PharmacyRules() {
  const { pharmacy, can } = useSession()
  const qc = useQueryClient(); const toast = useToast()
  const admin = can('admin')
  const [f, setF] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!pharmacy) return
    setF({
      name: pharmacy.name, address: pharmacy.address ?? '', phone: pharmacy.phone ?? '', pcn_premises_no: pharmacy.pcn_premises_no ?? '',
      min_shelf_life_days: String(pharmacy.min_shelf_life_days), expiry_warning_days: String(pharmacy.expiry_warning_days),
      rx_valid_days: String(pharmacy.rx_valid_days), rx_repeat_valid_days: String(pharmacy.rx_repeat_valid_days),
      fridge_min_c: String(pharmacy.fridge_min_c), fridge_max_c: String(pharmacy.fridge_max_c), room_max_c: String(pharmacy.room_max_c),
      receipt_footer: pharmacy.receipt_footer ?? '',
    })
  }, [pharmacy])
  const save = useMutation({
    mutationFn: async () => {
      const n = (k: string) => Number(f[k])
      const { error } = await supabase.from('ph_pharmacies').update({
        name: f.name!.trim(), address: f.address!.trim() || null, phone: f.phone!.trim() || null, pcn_premises_no: f.pcn_premises_no!.trim() || null,
        min_shelf_life_days: n('min_shelf_life_days'), expiry_warning_days: n('expiry_warning_days'),
        rx_valid_days: n('rx_valid_days'), rx_repeat_valid_days: n('rx_repeat_valid_days'),
        fridge_min_c: n('fridge_min_c'), fridge_max_c: n('fridge_max_c'), room_max_c: n('room_max_c'),
        receipt_footer: f.receipt_footer!.trim() || null,
      }).eq('id', pharmacy!.id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pharmacy'] }); toast('Rules saved') },
    onError: (e) => toast(friendlyError(e), { tone: 'error' }),
  })
  if (!pharmacy || !f.name) return null
  const inp = (k: string, props: Record<string, unknown> = {}) => <input className="input" disabled={!admin} value={f[k] ?? ''} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} {...props} />
  return (
    <div className="stack loose">
      {!admin && <Note tone="violet">Only the superintendent pharmacist can change these.</Note>}
      <div className="card stack">
        <h2 className="h3 row"><Store size={18} /> Pharmacy</h2>
        <Field label="Name">{inp('name')}</Field>
        <Field label="Address (on receipts)">{inp('address')}</Field>
        <div className="grid2"><Field label="Phone">{inp('phone', { inputMode: 'tel' })}</Field><Field label="PCN premises number">{inp('pcn_premises_no')}</Field></div>
        <Field label="Receipt footer">{inp('receipt_footer')}</Field>
      </div>
      <div className="card stack">
        <h2 className="h3">Prescriptions</h2>
        <div className="grid2">
          <Field label="New: fill within (days)" help="A new prescription can't be filled more than this many days after it was written.">{inp('rx_valid_days', { inputMode: 'numeric', className: 'input mono' })}</Field>
          <Field label="Repeat: fill within (days)">{inp('rx_repeat_valid_days', { inputMode: 'numeric', className: 'input mono' })}</Field>
        </div>
      </div>
      <div className="card stack">
        <h2 className="h3">Expiry</h2>
        <div className="grid2">
          <Field label="Refuse deliveries with less than (days)" help="Suppliers should deliver stock with plenty of life left. 180 days (6 months) is common.">{inp('min_shelf_life_days', { inputMode: 'numeric', className: 'input mono' })}</Field>
          <Field label="Warn me when this many days are left">{inp('expiry_warning_days', { inputMode: 'numeric', className: 'input mono' })}</Field>
        </div>
      </div>
      <div className="card stack">
        <h2 className="h3">Temperature</h2>
        <div className="grid3">
          <Field label="Fridge min °C">{inp('fridge_min_c', { inputMode: 'decimal', className: 'input mono' })}</Field>
          <Field label="Fridge max °C">{inp('fridge_max_c', { inputMode: 'decimal', className: 'input mono' })}</Field>
          <Field label="Room max °C">{inp('room_max_c', { inputMode: 'decimal', className: 'input mono' })}</Field>
        </div>
      </div>
      {admin && <button className="btn next lg" disabled={save.isPending} onClick={() => save.mutate()}>Save rules</button>}
    </div>
  )
}

/* ---------- staff ---------- */
function StaffTab() {
  const { can, staff: me } = useSession()
  const { data } = useStaffList()
  const qc = useQueryClient(); const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [reset, setReset] = useState<Staff | null>(null)
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Staff> }) => { const { error } = await supabase.from('ph_staff').update(patch).eq('id', id); if (error) throw error },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['staff'] }); qc.invalidateQueries({ queryKey: ['me'] }); toast('Saved') },
    onError: (e) => toast(friendlyError(e), { tone: 'error' }),
  })
  const admin = can('admin')
  return (
    <div className="stack">
      <div className="spread"><h2 className="h3 row"><Users size={18} /> {data?.length ?? 0} people</h2>{admin && <button className="btn next" onClick={() => setAdding(true)}><UserPlus size={18} /> Add staff</button>}</div>
      {!admin && <Note tone="violet">Only the superintendent pharmacist adds staff and changes roles.</Note>}
      <div className="card flush"><div className="list">
        {(data ?? []).map((s) => (
          <div key={s.id} className="li" style={{ cursor: 'default', flexWrap: 'wrap', opacity: s.is_active ? 1 : 0.6 }}>
            <Avatar name={s.full_name} />
            <div className="grow" style={{ minWidth: 160 }}>
              <div className="t">{s.full_name ?? s.email}{s.id === me?.id && <span className="muted"> (you)</span>}</div>
              <div className="s">{s.email}{s.pcn_reg_no ? ` · PCN ${s.pcn_reg_no}` : ''}</div>
            </div>
            {admin ? (
              <div className="row wrap">
                <select className="select" style={{ height: 40, width: 'auto' }} value={s.role} onChange={(e) => update.mutate({ id: s.id, patch: { role: e.target.value as Role } })}>
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                <Switch on={s.is_active} disabled={s.id === me?.id} onChange={(v) => update.mutate({ id: s.id, patch: { is_active: v } })} label={`${s.full_name} active`} />
                {s.id !== me?.id && <button className="icon-btn" aria-label="Reset password" title="Reset password" onClick={() => setReset(s)}><KeyRound size={18} /></button>}
              </div>
            ) : <Tag tone="pine">{ROLE_LABEL[s.role]}</Tag>}
          </div>
        ))}
      </div></div>
      <Note>Roles: <b>Superintendent pharmacist</b> runs everything. <b>Pharmacist</b> signs prescriptions, decides on quarantine, counts controlled drugs and voids sales. <b>Inventory officer</b> receives and counts stock. <b>Sales</b> uses the till.</Note>
      {adding && <AddStaff onClose={() => setAdding(false)} />}
      {reset && <ResetPw person={reset} onClose={() => setReset(null)} />}
    </div>
  )
}

async function manage(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('ph-manage-staff', { body })
  if (error) {
    const ctx = (error as { context?: Response }).context
    const msg = ctx ? ((await ctx.json().catch(() => null)) as { error?: string } | null)?.error : null
    throw new Error(msg ?? friendlyError(error))
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error)
  return data
}

function AddStaff({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast()
  const [f, setF] = useState({ full_name: '', email: '', password: '', role: 'sales' as Role, pcn_reg_no: '' })
  const save = useMutation({
    mutationFn: () => manage({ action: 'create', ...f }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['staff'] }); toast(`${f.full_name || f.email} added`); onClose() },
    onError: (e) => toast((e as Error).message, { tone: 'error' }),
  })
  return (
    <Sheet open onClose={onClose} title="Add staff" footer={<button className="btn next lg block" disabled={!f.email || save.isPending} onClick={() => save.mutate()}>Add to staff</button>}>
      <div className="stack loose">
        <Field label="Full name"><input className="input" autoFocus value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Email" hint="If they already use LabSync, use that email. They keep their password."><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Starting password" hint="At least 8 characters. Not needed for an existing LabSync login."><input className="input" type="text" autoComplete="off" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Field label="Role"><select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
        {(f.role === 'pharmacist' || f.role === 'admin') && <Field label="PCN registration number"><input className="input mono" value={f.pcn_reg_no} onChange={(e) => setF({ ...f, pcn_reg_no: e.target.value.toUpperCase() })} /></Field>}
      </div>
    </Sheet>
  )
}
function ResetPw({ person, onClose }: { person: Staff; onClose: () => void }) {
  const toast = useToast(); const [pw, setPw] = useState('')
  const save = useMutation({ mutationFn: () => manage({ action: 'reset_password', user_id: person.id, password: pw }), onSuccess: () => { toast('Password changed. Tell them in person.'); onClose() }, onError: (e) => toast((e as Error).message, { tone: 'error' }) })
  return (
    <Sheet open onClose={onClose} title={`New password for ${person.full_name ?? person.email}`} footer={<button className="btn next lg block" disabled={pw.length < 8 || save.isPending} onClick={() => save.mutate()}>Set password</button>}>
      <Field label="New password" hint="At least 8 characters"><input className="input" autoFocus autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
    </Sheet>
  )
}

/* ---------- shelves ---------- */
const KIND_LABEL: Record<Shelf['kind'], string> = { shelf: 'Shelf', fridge: 'Fridge', store: 'Store room', locked_cabinet: 'Locked cabinet', quarantine: 'Quarantine' }
function ShelvesTab({ editable }: { editable: boolean }) {
  const { data } = useShelves()
  const qc = useQueryClient(); const toast = useToast()
  const [name, setName] = useState(''); const [kind, setKind] = useState<Shelf['kind']>('shelf')
  const done = () => qc.invalidateQueries({ queryKey: ['shelves'] })
  const add = useMutation({ mutationFn: async () => { const { error } = await supabase.from('ph_shelves').insert({ name: name.trim(), kind }); if (error) throw error }, onSuccess: () => { done(); setName(''); toast('Shelf added') }, onError: (e) => toast(friendlyError(e), { tone: 'error' }) })
  const del = useMutation({ mutationFn: async (id: string) => { const { error } = await supabase.from('ph_shelves').delete().eq('id', id); if (error) throw error }, onSuccess: () => { done(); toast('Removed') }, onError: (e) => toast(friendlyError(e), { tone: 'error' }) })
  return (
    <div className="stack">
      <h2 className="h3 row"><Rows3 size={18} /> Where stock lives</h2>
      <div className="card flush"><div className="list">
        {(data ?? []).map((s) => (
          <div key={s.id} className="li" style={{ cursor: 'default' }}>
            <div className="grow t">{s.name}</div><Tag tone={s.kind === 'quarantine' ? 'violet' : s.kind === 'fridge' ? 'blue' : 'grey'}>{KIND_LABEL[s.kind]}</Tag>
            {editable && s.kind !== 'quarantine' && <button className="icon-btn plain" aria-label={`Remove ${s.name}`} onClick={() => del.mutate(s.id)}><Trash2 size={18} /></button>}
          </div>
        ))}
      </div></div>
      {editable && (
        <div className="card stack">
          <Field label="New shelf name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shelf G, Fridge 2" /></Field>
          <Seg value={kind} onChange={setKind} options={(['shelf', 'fridge', 'store', 'locked_cabinet'] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
          <button className="btn next" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}><Plus size={18} /> Add shelf</button>
        </div>
      )}
    </div>
  )
}

/* ---------- suppliers ---------- */
function SuppliersTab({ editable }: { editable: boolean }) {
  const { data } = useSuppliers()
  const [edit, setEdit] = useState<Partial<Supplier> | null>(null)
  return (
    <div className="stack">
      <div className="spread"><h2 className="h3 row"><Truck size={18} /> Suppliers</h2>{editable && <button className="btn next" onClick={() => setEdit({ accepts_returns: true })}><Plus size={18} /> Add supplier</button>}</div>
      <div className="card flush"><div className="list">
        {(data ?? []).length === 0 && <div className="li muted small" style={{ cursor: 'default' }}>No suppliers yet.</div>}
        {(data ?? []).map((s) => (
          <button key={s.id} className="li" onClick={() => editable && setEdit(s)}>
            <div className="grow"><div className="t">{s.name}</div><div className="s">{[s.phone, s.email].filter(Boolean).join(' · ') || 'No contact saved'}</div></div>
            {s.accepts_returns ? <Tag tone="green">Takes returns{s.return_window_days ? ` · ${s.return_window_days}d before expiry` : ''}</Tag> : <Tag>No returns</Tag>}
          </button>
        ))}
      </div></div>
      {edit && <SupplierSheet s={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}
function SupplierSheet({ s, onClose }: { s: Partial<Supplier>; onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast()
  const [f, setF] = useState({ name: s.name ?? '', phone: s.phone ?? '', email: s.email ?? '', accepts_returns: s.accepts_returns ?? true, return_window_days: s.return_window_days?.toString() ?? '', notes: s.notes ?? '' })
  const save = useMutation({
    mutationFn: async () => {
      const row = { name: f.name.trim(), phone: f.phone.trim() || null, email: f.email.trim() || null, accepts_returns: f.accepts_returns, return_window_days: f.return_window_days ? Number(f.return_window_days) : null, notes: f.notes.trim() || null }
      const { error } = s.id ? await supabase.from('ph_suppliers').update(row).eq('id', s.id) : await supabase.from('ph_suppliers').insert(row)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); toast('Supplier saved'); onClose() },
    onError: (e) => toast(friendlyError(e), { tone: 'error' }),
  })
  return (
    <Sheet open onClose={onClose} title={s.id ? 'Edit supplier' : 'Add supplier'} footer={<button className="btn next lg block" disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>Save supplier</button>}>
      <div className="stack loose">
        <Field label="Name"><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid2"><Field label="Phone"><input className="input mono" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field><Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field></div>
        <div className="spread"><span className="small b">Takes back short-dated stock</span><Switch on={f.accepts_returns} onChange={(v) => setF({ ...f, accepts_returns: v })} label="Takes returns" /></div>
        {f.accepts_returns && <Field label="Up to how many days before expiry?" hint="The expiry board reminds you before this window closes"><input className="input mono" inputMode="numeric" value={f.return_window_days} onChange={(e) => setF({ ...f, return_window_days: e.target.value.replace(/\D/g, '') })} /></Field>}
        <Field label="Notes"><textarea className="textarea" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Sheet>
  )
}

/* ---------- my PIN ---------- */
function PinTab() {
  const { staff } = useSession()
  const toast = useToast(); const qc = useQueryClient()
  const { data: has } = useQuery({ queryKey: ['has-pin'], queryFn: () => rpc<boolean>('ph_has_pin') })
  const [pin, setPin] = useState(''); const [again, setAgain] = useState('')
  const save = useMutation({
    mutationFn: () => rpc('ph_set_pin', { p_pin: pin }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['has-pin'] }); setPin(''); setAgain(''); toast('PIN saved') },
    onError: (e) => toast((e as Error).message, { tone: 'error' }),
  })
  const signer = staff?.role === 'admin' || staff?.role === 'pharmacist'
  return (
    <div className="card stack loose" style={{ maxWidth: 460 }}>
      <h2 className="h3 row"><KeyRound size={18} /> {has ? 'Change my signing PIN' : 'Set my signing PIN'}</h2>
      <p className="small muted">{signer ? 'You type this PIN to sign prescriptions at the counter. Keep it to yourself.' : 'Only pharmacists sign prescriptions. You only need a PIN if your role changes.'}</p>
      {has ? <Tag tone="green">PIN is set</Tag> : signer && <Note tone="amber">You can't sign prescriptions until you set a PIN.</Note>}
      <Field label="New PIN (4 to 6 digits)"><input className="input mono" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></Field>
      <Field label="Type it again" error={again && again !== pin ? "These don't match" : undefined}><input className="input mono" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))} /></Field>
      <button className="btn next" disabled={!/^\d{4,6}$/.test(pin) || pin !== again || save.isPending} onClick={() => save.mutate()}>Save PIN</button>
    </div>
  )
}

/* ---------- display ---------- */
function DisplayTab() {
  const [size, setSize] = useState<string>(() => { try { return localStorage.getItem('ps-size') ?? 'normal' } catch { return 'normal' } })
  useEffect(() => {
    document.documentElement.dataset.size = size === 'normal' ? '' : size
    try { localStorage.setItem('ps-size', size) } catch { /* ignore */ }
  }, [size])
  return (
    <div className="card stack" style={{ maxWidth: 460 }}>
      <h2 className="h3 row"><Type size={18} /> Text size on this device</h2>
      <Seg value={size} onChange={setSize} options={[{ value: 'small', label: 'Smaller' }, { value: 'normal', label: 'Normal' }, { value: 'large', label: 'Larger' }]} />
    </div>
  )
}
