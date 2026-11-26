import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Check, ClipboardCheck } from 'lucide-react'
import { supabase, q, rpc } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useStock, markCheck, useNeeds } from '../../lib/data'
import { useToast } from '../../lib/toast'
import { fmtWhen, medLabel, startOfTodayISO } from '../../lib/format'
import type { StockRow } from '../../lib/types'
import { Empty, Field, Note, PageHead, SecHead, Sheet, SkeletonRows, Tag } from '../../components/ui'

interface RegRow { id: string; type: string; quantity_delta: number; reason: string | null; balance_after: number | null; created_at: string; performer_name: string | null; batch_no: string | null; prescriber_name: string | null; patient_name: string | null; sale_number: number | null }

export default function Controlled() {
  const { can } = useSession()
  const [params] = useSearchParams()
  const { data: stock, isLoading } = useStock()
  const { data: needs } = useNeeds()
  const qc = useQueryClient(); const toast = useToast()
  const meds = useMemo(() => (stock ?? []).filter((m) => m.class === 'controlled'), [stock])
  const [sel, setSel] = useState<string | null>(null)
  const [count, setCount] = useState<StockRow | null>(null)
  const counts = useQuery({
    queryKey: ['controlled', 'counts-today'],
    queryFn: () => q<{ medicine_id: string; counted_qty: number; book_qty: number; created_at: string }[]>(supabase.from('ph_controlled_counts').select('medicine_id,counted_qty,book_qty,created_at').gte('created_at', startOfTodayISO())),
  })
  const counted = new Set((counts.data ?? []).map((c) => c.medicine_id))
  const allCounted = meds.length > 0 && meds.every((m) => counted.has(m.id))
  const checkDone = (needs?.checks ?? []).some((c) => c.check_key === 'controlled')

  useEffect(() => {
    if (allCounted && !checkDone && can('controlled')) markCheck('controlled').then(() => { qc.invalidateQueries({ queryKey: ['home'] }); toast('Locked cabinet count is done for today') }).catch(() => {})
  }, [allCounted, checkDone, can, qc, toast])

  const current = sel ?? meds[0]?.id ?? null
  const reg = useQuery({
    queryKey: ['controlled', 'register', current], enabled: !!current,
    queryFn: () => q<RegRow[]>(supabase.from('ph_controlled_register').select('*').eq('medicine_id', current!).order('created_at', { ascending: false }).limit(60)),
  })

  if (!can('controlled')) return <div className="page"><Note tone="violet">Only pharmacists open the controlled register.</Note></div>
  return (
    <div className="page stack">
      <PageHead title="Controlled register" sub="Every unit in and out of the locked cabinet, with a running balance." />
      {params.get('count') && !allCounted && <Note tone="violet" icon={<ClipboardCheck size={18} />}>Open the locked cabinet. Count each medicine below and tap <b>Count</b>. When all are counted, today's check is ticked.</Note>}
      {allCounted && <Note tone="green" icon={<Check size={18} />}>All controlled medicines counted today.</Note>}
      {isLoading ? <SkeletonRows /> : meds.length === 0 ? (
        <div className="card"><Empty icon={<Lock size={28} />} text="No controlled medicines yet. Mark a medicine as Controlled to see it here." /></div>
      ) : (
        <>
          <div className="card flush"><div className="list">
            {meds.map((m) => (
              <div key={m.id} className="li" style={{ cursor: 'default', background: m.id === current ? 'var(--violet-tint)' : undefined }}>
                <button className="grow" style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', padding: 0 }} onClick={() => setSel(m.id)}>
                  <div className="t">{medLabel(m)}</div>
                  <div className="s">Book balance <b className="mono">{Number(m.on_hand) + Number(m.quarantined)}</b> {m.unit}</div>
                </button>
                {counted.has(m.id) ? <Tag tone="green"><Check size={12} /> Counted</Tag> : <button className="btn sm next" onClick={() => setCount(m)}>Count</button>}
              </div>
            ))}
          </div></div>

          <SecHead title={`Register · ${meds.find((m) => m.id === current)?.name ?? ''}`} />
          <div className="card flush" style={{ overflowX: 'auto' }}>
            {reg.isLoading ? <SkeletonRows n={3} /> : (reg.data ?? []).length === 0 ? <Empty text="No movements yet." /> : (
              <table className="table">
                <thead><tr><th>When</th><th>What</th><th>Patient / prescriber</th><th>By</th><th className="r">In/out</th><th className="r">Balance</th></tr></thead>
                <tbody>
                  {reg.data!.map((r) => (
                    <tr key={r.id}>
                      <td className="small">{fmtWhen(r.created_at)}</td>
                      <td className="small"><b style={{ textTransform: 'capitalize' }}>{r.type}</b>{r.sale_number ? ` #${r.sale_number}` : ''}<div className="muted mono xs">{r.batch_no}</div></td>
                      <td className="small">{r.patient_name ?? '—'}{r.prescriber_name ? <div className="muted xs">{r.prescriber_name}</div> : null}</td>
                      <td className="small">{r.performer_name ?? '—'}</td>
                      <td className={`r mono ${r.quantity_delta < 0 ? 'c-red' : 'c-green'}`}>{r.quantity_delta > 0 ? '+' : ''}{r.quantity_delta}</td>
                      <td className="r mono b">{r.balance_after ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
      {count && <CountSheet med={count} onClose={() => setCount(null)} />}
    </div>
  )
}

function CountSheet({ med, onClose }: { med: StockRow; onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast()
  const [n, setN] = useState('')
  const [note, setNote] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const save = useMutation({
    mutationFn: () => rpc<{ book: number; counted: number; difference: number }>('ph_controlled_count', { p_medicine: med.id, p_counted: Number(n), p_note: note.trim() || null }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['controlled'] })
      toast(r.difference === 0 ? 'Matches the book' : `Recorded with a difference of ${r.difference}`); onClose()
    },
    onError: (e) => {
      const msg = (e as Error).message
      if (/doesn.t match the book/i.test(msg)) setMismatch(true)
      toast(msg, { tone: 'error' })
    },
  })
  return (
    <Sheet open onClose={onClose} title={`Count ${medLabel(med)}`}
      footer={<button className="btn next lg block" disabled={n === '' || save.isPending || (mismatch && !note.trim())} onClick={() => save.mutate()}>Save count</button>}>
      <div className="stack loose">
        <p className="muted">Count every {med.unit} in the locked cabinet, including any on hold. Don't look at the book number first.</p>
        <Field label={`How many ${med.unit} did you count?`}><input className="input mono" inputMode="numeric" autoFocus value={n} onChange={(e) => { setN(e.target.value.replace(/[^\d.]/g, '')); setMismatch(false) }} style={{ fontSize: '1.6rem', height: 64 }} /></Field>
        {mismatch && (
          <>
            <Note tone="red">That doesn't match the book. Count again. If it's still different, write what you found and tell the superintendent pharmacist today.</Note>
            <Field label="What did you find?"><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </>
        )}
      </div>
    </Sheet>
  )
}
