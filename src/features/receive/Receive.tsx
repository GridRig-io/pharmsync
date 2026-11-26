import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, Search, Check, PackageCheck, PauseCircle, Plus, ArrowLeft } from 'lucide-react'
import { rpc } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useShelves, useStock, useSuppliers } from '../../lib/data'
import { useToast } from '../../lib/toast'
import { daysUntil, fmtDate, medLabel } from '../../lib/format'
import type { StockRow } from '../../lib/types'
import { CheckRow, ClassTag, Field, Note, PageHead, Tag } from '../../components/ui'
import { CameraScan } from '../../components/CameraScan'
import { MedicineSheet } from '../medicines/MedicineSheet'

type CheckKey = 'sealed' | 'matches_invoice' | 'nafdac_printed' | 'genuine' | 'cold_ok'
const CHECKS: { key: CheckKey; title: string; sub: string; help: string; cold?: boolean }[] = [
  { key: 'sealed', title: 'Packs sealed and undamaged?', sub: 'No torn boxes, broken bottles, wet cartons', help: 'Open the carton and look at every pack. Broken seals can mean the medicine was opened or swapped.' },
  { key: 'matches_invoice', title: 'Matches the invoice?', sub: 'Same name, strength and number of packs', help: 'Compare the delivery with the supplier\'s invoice line by line. Write down anything missing.' },
  { key: 'nafdac_printed', title: 'NAFDAC number on the pack?', sub: 'Looks like A4-1234 or 04-5678', help: 'Every medicine sold in Nigeria must carry a NAFDAC registration number. No number means do not sell it.' },
  { key: 'genuine', title: 'Looks genuine?', sub: 'Same print and colour as usual; scratch code checks out', help: 'If there is a scratch-off code, text it to the number on the pack (Mobile Authentication Service). Blurry print or a different colour from usual is a warning sign.' },
  { key: 'cold_ok', title: 'Arrived cold?', sub: 'In a cool box or with ice packs', help: 'Fridge medicines (insulin, vaccines) must stay between 2 and 8 °C the whole way. If the box arrived warm, hold it for the pharmacist.', cold: true },
]
const LAST_SUPPLIER = 'ps-last-supplier'

export default function Receive() {
  const { can, pharmacy } = useSession()
  const [params] = useSearchParams()
  const { data: stock } = useStock()
  const { data: suppliers } = useSuppliers()
  const { data: shelves } = useShelves()
  const qc = useQueryClient(); const toast = useToast()

  const [step, setStep] = useState(1)
  const [term, setTerm] = useState('')
  const [scan, setScan] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [med, setMed] = useState<StockRow | null>(null)
  const [supplier, setSupplier] = useState(() => { try { return localStorage.getItem(LAST_SUPPLIER) ?? '' } catch { return '' } })
  const [answers, setAnswers] = useState<Partial<Record<CheckKey, boolean>>>({})
  const [batchNo, setBatchNo] = useState('')
  const [expiry, setExpiry] = useState('')
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState('')
  const [shelf, setShelf] = useState('')
  const [override, setOverride] = useState(false)
  const [note, setNote] = useState('')
  const [result, setResult] = useState<null | { quarantine: boolean; shelf: string }>(null)

  useEffect(() => {
    const id = params.get('medicine')
    if (id && stock && !med) { const m = stock.find((s) => s.id === id); if (m) pick(m) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, stock])

  const matches = useMemo(() => {
    const t = term.trim().toLowerCase()
    if (!t) return []
    return (stock ?? []).filter((m) => m.barcode === term.trim() || [m.name, m.brand].some((x) => x?.toLowerCase().includes(t))).slice(0, 8)
  }, [stock, term])

  function pick(m: StockRow) {
    setMed(m); setStep(2); setAnswers({}); setCost(m.cost_price?.toString() ?? '')
    const fridge = shelves?.find((s) => s.kind === 'fridge')
    setShelf(m.default_shelf_id ?? (m.cold_chain ? fridge?.id ?? '' : ''))
  }
  const checks = CHECKS.filter((c) => !c.cold || med?.cold_chain)
  const answered = checks.every((c) => answers[c.key] != null)
  const failed = checks.filter((c) => answers[c.key] === false)
  const currentCheck = checks.find((c) => answers[c.key] == null)?.key

  const days = daysUntil(expiry || null)
  const minDays = pharmacy?.min_shelf_life_days ?? 180
  const short = days != null && days >= 0 && days < minDays
  const expired = days != null && days < 0
  const q = failed.length > 0 || expired
  const canSave = !!med && batchNo.trim() && expiry && Number(qty) > 0 && (!short || q || override)

  const save = useMutation({
    mutationFn: () => rpc<string>('ph_receive', {
      p_medicine: med!.id, p_batch_no: batchNo.trim(), p_expiry: expiry, p_qty: Number(qty),
      p_shelf: q ? (shelves?.find((s) => s.kind === 'quarantine')?.id ?? null) : (shelf || null),
      p_supplier: supplier || null, p_cost: cost ? Number(cost) : null,
      p_checks: Object.fromEntries(checks.map((c) => [c.key, answers[c.key] ?? null])),
      p_quarantine_reason: q ? (expired ? 'expired' : 'failed_check') : null,
      p_note: [failed.length ? `Failed: ${failed.map((f) => f.title).join('; ')}` : '', note.trim()].filter(Boolean).join(' · ') || null,
      p_override_shelf_life: override,
    }),
    onSuccess: () => {
      ;['stock', 'batches', 'home', 'medicine'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      try { if (supplier) localStorage.setItem(LAST_SUPPLIER, supplier) } catch { /* ignore */ }
      const s = q ? (shelves?.find((x) => x.kind === 'quarantine')?.name ?? 'the quarantine shelf') : (shelves?.find((x) => x.id === shelf)?.name ?? 'its shelf')
      setResult({ quarantine: q, shelf: s }); setStep(5)
    },
    onError: (e) => toast((e as Error).message, { tone: 'error' }),
  })

  const reset = () => { setStep(1); setMed(null); setTerm(''); setAnswers({}); setBatchNo(''); setExpiry(''); setQty(''); setCost(''); setOverride(false); setNote(''); setResult(null) }

  if (!can('stock.write')) return <div className="page"><Note tone="violet">Only pharmacists and inventory officers receive deliveries.</Note></div>

  const steps = ['Medicine', 'Checks', 'Batch', 'Shelf']
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <PageHead kicker={step < 5 ? `Step ${step} of 4 · ${steps[step - 1]}` : 'Done'} title="Receive a delivery" />
      {step < 5 && (
        <div className="row" style={{ gap: 4, marginBottom: 16 }}>
          {steps.map((s, i) => <div key={s} style={{ flex: 1, height: 6, borderRadius: 3, background: i + 1 < step ? 'var(--pine)' : i + 1 === step ? 'var(--lime)' : 'var(--rule)' }} />)}
        </div>
      )}
      {med && step > 1 && step < 5 && (
        <div className="card row" style={{ marginBottom: 14 }}>
          <div className="grow"><div className="b">{medLabel(med)}</div><div className="small muted">{med.brand ?? ''} · counted in {med.unit}</div></div>
          <ClassTag cls={med.class} />
        </div>
      )}

      {step === 1 && (
        <div className="stack loose">
          <Field label="Supplier">
            <select className="select" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="">Not recorded</option>{(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <div className="row scan-field" style={{ position: 'relative' }}>
            <div className="input-ic grow">
              <Search size={18} />
              <input className="input" autoFocus placeholder="Scan the pack or type its name" value={term} onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && matches.length === 1) pick(matches[0]!) }} />
            </div>
            <button className="icon-btn" style={{ width: 54, height: 54 }} aria-label="Scan with camera" onClick={() => setScan(true)}><Camera size={22} /></button>
          </div>
          {term.trim() && (
            <div className="card flush"><div className="list">
              {matches.map((m) => (
                <button key={m.id} className="li" onClick={() => pick(m)}>
                  <div className="grow"><div className="t">{medLabel(m)}</div><div className="s">{m.brand ?? ''} · {m.on_hand} {m.unit} now</div></div>
                  {m.class !== 'otc' && <ClassTag cls={m.class} />}
                </button>
              ))}
              <button className="li" onClick={() => setAdding(/^\d{6,}$/.test(term.trim()) ? term.trim() : '')}>
                <span className="chip-ic ic-pine"><Plus size={18} /></span>
                <div className="grow"><div className="t">New medicine</div><div className="s">Not on the list yet? Add it first</div></div>
              </button>
            </div></div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="stack loose">
          <p className="muted">Look at the delivery and answer each one. Any <b>No</b> puts it on hold for a pharmacist.</p>
          <div className="card flush"><div className="list">
            {checks.map((c) => (
              <CheckRow key={c.key} title={c.title} sub={c.sub} help={c.help} value={answers[c.key] ?? null} current={c.key === currentCheck}
                onChange={(v) => setAnswers((a) => ({ ...a, [c.key]: v }))} />
            ))}
          </div></div>
          {failed.length > 0 && <Note tone="violet" icon={<PauseCircle size={18} />}>This delivery will go to the <b>quarantine shelf</b>, not on sale. A pharmacist will decide whether to return it.</Note>}
          <div className="row"><button className="btn soft" onClick={() => setStep(1)}><ArrowLeft size={16} /> Back</button><button className="btn next grow lg" disabled={!answered} onClick={() => setStep(3)}>Next: batch and expiry</button></div>
        </div>
      )}

      {step === 3 && (
        <div className="stack loose">
          <Field label="Batch number" hint="Printed near the expiry date: BN, LOT or B/N" help="Each batch is tracked on its own, so a recall or expiry hits only the right packs.">
            <input className="input mono" autoFocus value={batchNo} onChange={(e) => setBatchNo(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Expiry date" hint="If the pack only shows month and year, choose the last day of that month">
            <input className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </Field>
          {expired && <Note tone="red">Already expired. It will be recorded and sent straight to quarantine.</Note>}
          {short && !q && (
            <Note tone="amber">
              Only <b>{days} days</b> left. Your rule is at least <b>{minDays} days</b> ({Math.round(minDays / 30)} months).
              {can('rx.sign') ? ' Refuse it, or accept it only if you agreed this with the supplier.' : ' Refuse it, or ask a pharmacist to accept it.'}
            </Note>
          )}
          {short && !q && can('rx.sign') && (
            <label className="row small b" style={{ cursor: 'pointer' }}><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} style={{ width: 20, height: 20 }} /> I'm a pharmacist and I accept this short-dated stock</label>
          )}
          <div className="grid2">
            <Field label={`How many ${med?.unit ?? 'packs'} arrived?`}><input className="input mono" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
            <Field label="Cost per unit (₦)"><input className="input mono" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
          </div>
          <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. invoice number" /></Field>
          <div className="row"><button className="btn soft" onClick={() => setStep(2)}><ArrowLeft size={16} /> Back</button><button className="btn next grow lg" disabled={!canSave} onClick={() => setStep(4)}>Next: shelf</button></div>
        </div>
      )}

      {step === 4 && (
        <div className="stack loose">
          {q ? (
            <Note tone="violet" icon={<PauseCircle size={18} />}>Goes to the <b>{shelves?.find((s) => s.kind === 'quarantine')?.name ?? 'quarantine shelf'}</b>. Label it "Do not sell".</Note>
          ) : (
            <Field label="Where will you put it?">
              <div className="stack tight">
                {(shelves ?? []).filter((s) => s.kind !== 'quarantine').map((s) => (
                  <button key={s.id} type="button" className={`pay-method ${shelf === s.id ? 'on' : ''}`} onClick={() => setShelf(s.id)}>
                    <div className="spread"><span className="t">{s.name}</span>{s.id === med?.default_shelf_id && <Tag tone="pine">Usual place</Tag>}{s.kind === 'fridge' && med?.cold_chain && s.id !== med.default_shelf_id && <Tag tone="blue">Fridge</Tag>}</div>
                  </button>
                ))}
              </div>
            </Field>
          )}
          {med?.cold_chain && !q && shelves?.find((s) => s.id === shelf)?.kind !== 'fridge' && <Note tone="amber">This medicine needs the fridge.</Note>}
          <div className="card stack tight small">
            <div className="spread"><span className="muted">Batch</span><b className="mono">{batchNo}</b></div>
            <div className="spread"><span className="muted">Expires</span><b>{fmtDate(expiry)}</b></div>
            <div className="spread"><span className="muted">Quantity</span><b>{qty} {med?.unit}</b></div>
          </div>
          <div className="row"><button className="btn soft" onClick={() => setStep(3)}><ArrowLeft size={16} /> Back</button><button className="btn next grow lg" disabled={save.isPending || (!q && !shelf)} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save delivery'}</button></div>
        </div>
      )}

      {step === 5 && result && (
        <div className="card stack loose" style={{ alignItems: 'center', textAlign: 'center' }}>
          <span className={`chip-ic ${result.quarantine ? 'ic-violet' : 'ic-green'}`} style={{ width: 56, height: 56 }}>{result.quarantine ? <PauseCircle size={28} /> : <PackageCheck size={28} />}</span>
          <h2 className="h2">{result.quarantine ? 'Saved, on hold' : 'Saved'}</h2>
          <p className="muted">Now put {qty} {med?.unit} of {med && medLabel(med)} on <b>{result.shelf}</b>{result.quarantine ? ' and tell the pharmacist.' : ', behind any older stock.'}</p>
          <div className="row wrap" style={{ justifyContent: 'center' }}>
            <button className="btn next lg" onClick={reset}><Check size={18} /> Receive the next item</button>
            <Link className="btn soft lg" to="/">Finish</Link>
          </div>
        </div>
      )}

      {scan && <CameraScan onClose={() => setScan(false)} onCode={(c) => { setScan(false); setTerm(c); const m = (stock ?? []).find((s) => s.barcode === c); if (m) pick(m) }} />}
      {adding != null && <MedicineSheet barcode={adding} onClose={() => setAdding(null)} onSaved={(id) => { qc.invalidateQueries({ queryKey: ['stock'] }).then(() => { const m = qc.getQueryData<StockRow[]>(['stock'])?.find((s) => s.id === id); if (m) pick(m) }) }} />}
    </div>
  )
}
