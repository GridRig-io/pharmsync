import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, Plus, Trash2, ShieldCheck, Search } from 'lucide-react'
import { supabase, rpc, friendlyError } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useStaffList, useStock } from '../../lib/data'
import { useToast } from '../../lib/toast'
import { daysUntil, fmtDate, medLabel, rxValidUntil, todayISO } from '../../lib/format'
import { CheckRow, ClassTag, Field, Note, Seg, Sheet, Switch } from '../../components/ui'

export interface SavedRx { id: string; items: { id: string; medicine_id: string }[]; patient: string; prescriber: string; valid_until: string; qty: Record<string, number> }
interface Line { medicine_id: string; label: string; qty: string; directions: string }

/** Record a prescription before an Rx-only medicine can be sold. A pharmacist signs it with their PIN. */
export function RxSheet({ onClose, onSaved, preset }: { onClose: () => void; onSaved?: (rx: SavedRx) => void; preset?: { medicine_id: string; label: string; qty: number }[] }) {
  const { pharmacy, staff } = useSession()
  const { data: stock } = useStock()
  const { data: team } = useStaffList()
  const qc = useQueryClient(); const toast = useToast()
  const signers = (team ?? []).filter((s) => s.is_active && (s.role === 'admin' || s.role === 'pharmacist'))

  const [p, setP] = useState({ patient_name: '', patient_age: '', patient_sex: '' as '' | 'female' | 'male', patient_phone: '', prescriber_name: '', prescriber_mdcn: '', facility: '', date_written: todayISO(), is_repeat: false, notes: '' })
  const [lines, setLines] = useState<Line[]>(() => (preset ?? []).map((x) => ({ medicine_id: x.medicine_id, label: x.label, qty: String(x.qty), directions: '' })))
  const [checks, setChecks] = useState<{ signed_stamped: boolean | null; recent: boolean | null; dose_ok: boolean | null }>({ signed_stamped: null, recent: null, dose_ok: null })
  const [photo, setPhoto] = useState<File | null>(null)
  const [signer, setSigner] = useState<string>(staff && (staff.role === 'admin' || staff.role === 'pharmacist') ? staff.id : '')
  const [pin, setPin] = useState('')
  const [find, setFind] = useState('')
  const set = <K extends keyof typeof p>(k: K, v: (typeof p)[K]) => setP((x) => ({ ...x, [k]: v }))

  const limit = p.is_repeat ? pharmacy?.rx_repeat_valid_days ?? 30 : pharmacy?.rx_valid_days ?? 7
  const validUntil = p.date_written && pharmacy ? rxValidUntil(p.date_written, p.is_repeat, pharmacy) : null
  const left = daysUntil(validUntil)
  const tooOld = left != null && left < 0
  const future = !!p.date_written && p.date_written > todayISO()
  const found = useMemo(() => {
    const t = find.trim().toLowerCase(); if (!t) return []
    return (stock ?? []).filter((m) => !lines.some((l) => l.medicine_id === m.id) && (m.barcode === find.trim() || [m.name, m.brand].some((x) => x?.toLowerCase().includes(t)))).slice(0, 6)
  }, [stock, find, lines])

  const allYes = checks.signed_stamped === true && checks.recent === true && checks.dose_ok === true
  const anyNo = Object.values(checks).some((v) => v === false)
  const ready = p.patient_name.trim() && p.prescriber_name.trim() && p.prescriber_mdcn.trim() && lines.length > 0 && lines.every((l) => Number(l.qty) > 0) && allYes && !tooOld && !future && signer && /^\d{4,6}$/.test(pin)

  const save = useMutation({
    mutationFn: async () => {
      let photo_path: string | null = null
      if (photo && pharmacy) {
        const ext = (photo.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
        photo_path = `${pharmacy.id}/${crypto.randomUUID()}.${ext}`
        const { error } = await supabase.storage.from('ph-prescriptions').upload(photo_path, photo, { contentType: photo.type || 'image/jpeg' })
        if (error) throw new Error(`Couldn't upload the photo: ${friendlyError(error)}`)
      }
      const res = await rpc<{ id: string; items: { id: string; medicine_id: string }[] }>('ph_create_prescription', {
        p: { ...p, patient_age: p.patient_age || null, patient_sex: p.patient_sex || null, photo_path, checks },
        p_items: lines.map((l) => ({ medicine_id: l.medicine_id, qty_prescribed: Number(l.qty), directions: l.directions || null })),
        p_signer: signer, p_pin: pin,
      })
      return res
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['rx'] })
      toast('Prescription saved')
      onSaved?.({ ...res, patient: p.patient_name.trim(), prescriber: p.prescriber_name.trim(), valid_until: validUntil!, qty: Object.fromEntries(lines.map((l) => [l.medicine_id, Number(l.qty)])) })
      onClose()
    },
    onError: (e) => { setPin(''); toast((e as Error).message, { tone: 'error' }) },
  })

  return (
    <Sheet open onClose={onClose} wide title="Record a prescription"
      footer={<><button className="btn soft" onClick={onClose}>Cancel</button><button className="btn next grow" disabled={!ready || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Sign and save'}</button></>}>
      <div className="stack loose">
        <section className="stack">
          <h3 className="eyebrow">1 · The paper prescription</h3>
          <label className="btn soft block" style={{ cursor: 'pointer' }}>
            <Camera size={18} /> {photo ? `Photo added: ${photo.name.slice(0, 24)}` : 'Take a photo of it'}
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          </label>
          <div className="grid2">
            <Field label="Date written"><input className="input" type="date" max={todayISO()} value={p.date_written} onChange={(e) => set('date_written', e.target.value)} /></Field>
            <Field label="Repeat prescription?" help={`A new prescription can be filled within ${pharmacy?.rx_valid_days ?? 7} days of being written. A repeat (refill) one, within ${pharmacy?.rx_repeat_valid_days ?? 30} days.`}>
              <div className="row" style={{ height: 48 }}><Switch on={p.is_repeat} onChange={(v) => set('is_repeat', v)} label="Repeat prescription" /><span className="small">{p.is_repeat ? 'Yes, a refill' : 'No, new'}</span></div>
            </Field>
          </div>
          {future ? <Note tone="red">The date can't be in the future.</Note> : tooOld ? (
            <Note tone="red"><b>Too old to fill.</b> Written {fmtDate(p.date_written)}, the limit is {limit} days. Don't dispense: ask the patient for a new prescription.</Note>
          ) : validUntil && <Note tone="green">Can be filled until <b>{fmtDate(validUntil)}</b> ({left === 0 ? 'today is the last day' : `${left} day${left === 1 ? '' : 's'} left`}).</Note>}
        </section>

        <section className="stack">
          <h3 className="eyebrow">2 · Patient</h3>
          <Field label="Patient's full name"><input className="input" value={p.patient_name} onChange={(e) => set('patient_name', e.target.value)} /></Field>
          <div className="grid3">
            <Field label="Age"><input className="input mono" inputMode="numeric" value={p.patient_age} onChange={(e) => set('patient_age', e.target.value.replace(/\D/g, ''))} /></Field>
            <div className="field" style={{ gridColumn: 'span 2' }}><span className="lbl">Sex</span>
              <Seg value={p.patient_sex || ('' as never)} onChange={(v) => set('patient_sex', v)} options={[{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }]} />
            </div>
          </div>
          <Field label="Phone (optional)"><input className="input mono" inputMode="tel" value={p.patient_phone} onChange={(e) => set('patient_phone', e.target.value)} /></Field>
        </section>

        <section className="stack">
          <h3 className="eyebrow">3 · Prescriber</h3>
          <div className="grid2">
            <Field label="Doctor's name"><input className="input" value={p.prescriber_name} onChange={(e) => set('prescriber_name', e.target.value)} placeholder="Dr …" /></Field>
            <Field label="MDCN number" help="Every doctor in Nigeria has a Medical and Dental Council of Nigeria registration number. It's usually on the stamp."><input className="input mono" value={p.prescriber_mdcn} onChange={(e) => set('prescriber_mdcn', e.target.value.toUpperCase())} /></Field>
          </div>
          <Field label="Hospital or clinic (optional)"><input className="input" value={p.facility} onChange={(e) => set('facility', e.target.value)} /></Field>
        </section>

        <section className="stack">
          <h3 className="eyebrow">4 · Medicines on it</h3>
          {lines.map((l, i) => (
            <div key={l.medicine_id} className="card stack tight">
              <div className="spread"><span className="b">{l.label}</span><button className="icon-btn plain" aria-label={`Remove ${l.label}`} onClick={() => setLines((x) => x.filter((_, j) => j !== i))}><Trash2 size={18} /></button></div>
              <div className="grid2">
                <Field label="Quantity prescribed"><input className="input mono" inputMode="numeric" value={l.qty} onChange={(e) => setLines((x) => x.map((y, j) => j === i ? { ...y, qty: e.target.value.replace(/[^\d.]/g, '') } : y))} /></Field>
                <Field label="Directions"><input className="input" placeholder="1 tab 3× daily, 5 days" value={l.directions} onChange={(e) => setLines((x) => x.map((y, j) => j === i ? { ...y, directions: e.target.value } : y))} /></Field>
              </div>
            </div>
          ))}
          <div style={{ position: 'relative' }}>
            <div className="input-ic"><Search size={18} /><input className="input" placeholder="Add a medicine from the prescription" value={find} onChange={(e) => setFind(e.target.value)} /></div>
            {found.length > 0 && (
              <div className="results"><div className="list">
                {found.map((m) => (
                  <button key={m.id} className="li" onClick={() => { setLines((x) => [...x, { medicine_id: m.id, label: medLabel(m), qty: '1', directions: '' }]); setFind('') }}>
                    <Plus size={18} /><div className="grow"><div className="t">{medLabel(m)}</div><div className="s">sold as {m.unit}</div></div><ClassTag cls={m.class} />
                  </button>
                ))}
              </div></div>
            )}
          </div>
        </section>

        <section className="stack">
          <h3 className="eyebrow">5 · Pharmacist checks</h3>
          <div className="card flush"><div className="list">
            <CheckRow title="Signed and stamped by the doctor?" sub="Signature plus stamp with name and MDCN number" value={checks.signed_stamped} onChange={(v) => setChecks((c) => ({ ...c, signed_stamped: v }))} />
            <CheckRow title={`Written within ${limit} days?`} sub={p.is_repeat ? 'Repeat prescriptions: up to 30 days' : 'New prescriptions: up to 7 days'} value={checks.recent} onChange={(v) => setChecks((c) => ({ ...c, recent: v }))} />
            <CheckRow title="Dose and amount make sense?" sub="Right for the patient's age; no dangerous mix with other medicines" value={checks.dose_ok} onChange={(v) => setChecks((c) => ({ ...c, dose_ok: v }))} />
          </div></div>
          {anyNo && <Note tone="red">A check is <b>No</b>. Don't dispense. Explain to the patient and refer them back to the doctor.</Note>}
        </section>

        <section className="stack">
          <h3 className="eyebrow">6 · Sign</h3>
          {signers.length === 0 ? <Note tone="amber">No pharmacist on the staff list yet. The admin can add one in Settings → Staff.</Note> : (
            <div className="grid2">
              <Field label="Pharmacist">
                <select className="select" value={signer} onChange={(e) => setSigner(e.target.value)}>
                  <option value="">Choose…</option>{signers.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? s.email}</option>)}
                </select>
              </Field>
              <Field label="Their PIN" help="Each pharmacist sets a 4 to 6 digit PIN in Settings → My PIN. It proves they checked this prescription."><input className="input mono" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></Field>
            </div>
          )}
          <Note tone="violet" icon={<ShieldCheck size={18} />}>Saved with the pharmacist's name and time. Keep the paper prescription in the Rx file.</Note>
        </section>
      </div>
    </Sheet>
  )
}
