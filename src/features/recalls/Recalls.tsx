import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Siren, Plus, Check } from 'lucide-react'
import { supabase, q, rpc, friendlyError } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useStock } from '../../lib/data'
import { useToast } from '../../lib/toast'
import { fmtDate, medLabel } from '../../lib/format'
import type { Recall } from '../../lib/types'
import { Empty, Field, Note, PageHead, Seg, Sheet, SkeletonRows, Tag } from '../../components/ui'

export default function Recalls() {
  const { can } = useSession()
  const { data: stock } = useStock()
  const qc = useQueryClient(); const toast = useToast()
  const [tab, setTab] = useState<'open' | 'closed'>('open')
  const [adding, setAdding] = useState(false)
  const { data, isLoading } = useQuery({ queryKey: ['recalls', tab], queryFn: () => q<Recall[]>(supabase.from('ph_recalls').select('*').eq('status', tab).order('created_at', { ascending: false })) })
  const name = (id: string) => { const m = stock?.find((s) => s.id === id); return m ? medLabel(m) : 'Medicine' }
  const close = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('ph_recalls').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', id); if (error) throw error },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recalls'] }); qc.invalidateQueries({ queryKey: ['home'] }); toast('Recall closed') },
    onError: (e) => toast(friendlyError(e), { tone: 'error' }),
  })
  return (
    <div className="page stack">
      <PageHead title="Recalls" sub="When NAFDAC or a manufacturer recalls a batch, every matching pack is taken off sale at once."
        actions={can('recall') && <button className="btn next" onClick={() => setAdding(true)}><Plus size={18} /> Record a recall</button>} />
      <Seg value={tab} onChange={setTab} options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }]} />
      {isLoading ? <SkeletonRows /> : (data ?? []).length === 0 ? (
        <div className="card"><Empty icon={<Siren size={28} />} text={tab === 'open' ? 'No open recalls.' : 'No closed recalls yet.'} /></div>
      ) : (
        <div className="stack">
          {data!.map((r) => (
            <div key={r.id} className="card stack tight">
              <div className="spread"><span className="b">{name(r.medicine_id)}</span>{r.batch_no ? <Tag tone="red">Batch {r.batch_no}</Tag> : <Tag tone="red">All batches</Tag>}</div>
              <p className="small">{r.reason}</p>
              <p className="xs muted">{r.reference ? `${r.reference} · ` : ''}{fmtDate(r.created_at)}</p>
              {r.status === 'open' && (
                <Note tone="red">Check every shelf, the fridge and the store room for this {r.batch_no ? 'batch' : 'medicine'}. Move any packs to the quarantine shelf.</Note>
              )}
              {r.status === 'open' && can('recall') && <button className="btn soft sm" style={{ alignSelf: 'flex-start' }} onClick={() => close.mutate(r.id)}><Check size={16} /> Done, all packs off the shelves</button>}
            </div>
          ))}
        </div>
      )}
      {adding && <RecallSheet onClose={() => setAdding(false)} />}
    </div>
  )
}

function RecallSheet({ onClose }: { onClose: () => void }) {
  const { data: stock } = useStock()
  const qc = useQueryClient(); const toast = useToast()
  const [term, setTerm] = useState('')
  const [med, setMed] = useState<string>('')
  const [batch, setBatch] = useState('')
  const [reason, setReason] = useState('')
  const [ref, setRef] = useState('')
  const hits = useMemo(() => { const t = term.trim().toLowerCase(); return t ? (stock ?? []).filter((m) => [m.name, m.brand].some((x) => x?.toLowerCase().includes(t))).slice(0, 6) : [] }, [stock, term])
  const save = useMutation({
    mutationFn: () => rpc<number>('ph_create_recall', { p_medicine: med, p_batch_no: batch.trim() || null, p_reason: reason.trim(), p_reference: ref.trim() || null }),
    onSuccess: (n) => { ['recalls', 'home', 'batches', 'stock'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast(n ? `${n} batch${n === 1 ? '' : 'es'} taken off sale` : 'Recall saved. No matching stock on file.'); onClose() },
    onError: (e) => toast((e as Error).message, { tone: 'error' }),
  })
  const chosen = stock?.find((m) => m.id === med)
  return (
    <Sheet open onClose={onClose} title="Record a recall" footer={<button className="btn next lg block" disabled={!med || !reason.trim() || save.isPending} onClick={() => save.mutate()}>Take matching stock off sale</button>}>
      <div className="stack loose">
        {chosen ? (
          <div className="card spread"><span className="b">{medLabel(chosen)}</span><button className="link" onClick={() => setMed('')}>Change</button></div>
        ) : (
          <Field label="Which medicine?">
            <input className="input" autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Type the name" />
            {hits.length > 0 && <div className="card flush"><div className="list">{hits.map((m) => <button key={m.id} className="li" onClick={() => { setMed(m.id); setTerm('') }}><div className="t">{medLabel(m)}</div></button>)}</div></div>}
          </Field>
        )}
        <Field label="Batch number" hint="Leave empty if every batch is recalled"><input className="input mono" value={batch} onChange={(e) => setBatch(e.target.value.toUpperCase())} /></Field>
        <Field label="Why?"><textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. NAFDAC alert: substandard, fails dissolution test" /></Field>
        <Field label="Notice reference (optional)"><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. NAFDAC Public Alert No. 012/2026" /></Field>
      </div>
    </Sheet>
  )
}
