import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PauseCircle, PlayCircle, Trash2, Undo2, ClipboardCheck, MoveRight } from 'lucide-react'
import { supabase, rpc, friendlyError } from '../lib/supabase'
import { useSession } from '../lib/session'
import { useShelves } from '../lib/data'
import { useToast } from '../lib/toast'
import { fmtDate, REASON_LABEL } from '../lib/format'
import type { BatchRow, QReason } from '../lib/types'
import { Field, LabelCard, Note, Sheet, Tag } from './ui'

type Mode = null | 'quarantine' | 'count' | 'move' | 'dispose'

export function BatchSheet({ batch, onClose }: { batch: BatchRow; onClose: () => void }) {
  const { can, pharmacy } = useSession()
  const { data: shelves } = useShelves()
  const qc = useQueryClient(); const toast = useToast()
  const [mode, setMode] = useState<Mode>(null)
  const [reason, setReason] = useState<QReason>(batch.days_left < 0 ? 'expired' : 'damaged')
  const [note, setNote] = useState('')
  const [counted, setCounted] = useState(String(batch.quantity))
  const [shelf, setShelf] = useState(batch.shelf_id ?? '')
  const [how, setHow] = useState<'returned_to_supplier' | 'destroyed'>(batch.accepts_returns ? 'returned_to_supplier' : 'destroyed')

  const done = (msg: string) => {
    ;['batches', 'stock', 'home', 'medicine'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
    toast(msg); onClose()
  }
  const act = useMutation({
    mutationFn: async (m: Exclude<Mode, null> | 'release') => {
      if (m === 'quarantine') return rpc('ph_quarantine', { p_batch: batch.id, p_reason: reason, p_note: note.trim() || null })
      if (m === 'release') return rpc('ph_release', { p_batch: batch.id })
      if (m === 'dispose') return rpc('ph_dispose', { p_batch: batch.id, p_how: how, p_note: note.trim() || null })
      if (m === 'count') return rpc('ph_adjust', { p_batch: batch.id, p_counted: Number(counted), p_reason: note.trim() || null })
      const { error } = await supabase.from('ph_batches').update({ shelf_id: shelf || null }).eq('id', batch.id)
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: (_d, m) => done({ quarantine: 'Moved to quarantine. Put it on the quarantine shelf now.', release: 'Back on sale', dispose: 'Recorded and removed from stock', count: 'Count saved', move: 'Shelf updated' }[m]),
    onError: (e) => toast((e as Error).message, { tone: 'error' }),
  })

  const q = batch.status === 'quarantine'
  const diff = Number(counted) - Number(batch.quantity)
  return (
    <Sheet open onClose={onClose} title={`Batch ${batch.batch_no}`}>
      <div className="stack loose">
        <LabelCard daysLeft={batch.days_left} warnDays={pharmacy?.expiry_warning_days ?? 90} quarantine={q}>
          <span className="b">{batch.medicine_name}{batch.strength ? ` ${batch.strength}` : ''}</span>
          <span className="small muted">Expires {fmtDate(batch.expiry_date)} · {batch.quantity} {batch.unit}</span>
          <span className="small muted">{batch.shelf_name ?? 'No shelf'}{batch.supplier_name ? ` · from ${batch.supplier_name}` : ''}</span>
          {q && batch.quarantine_reason && <span><Tag tone="violet">{REASON_LABEL[batch.quarantine_reason]}</Tag></span>}
        </LabelCard>
        {q && batch.quarantine_note && <Note>{batch.quarantine_note}</Note>}

        {mode === null && (
          <div className="stack">
            {!q && batch.status === 'available' && <button className="btn violet block" onClick={() => setMode('quarantine')}><PauseCircle size={18} /> Take off sale (quarantine)</button>}
            {q && can('batch.decide') && batch.days_left >= 0 && <button className="btn block" onClick={() => act.mutate('release')} disabled={act.isPending}><PlayCircle size={18} /> Put back on sale</button>}
            {q && can('batch.decide') && <button className="btn danger block" onClick={() => setMode('dispose')}><Trash2 size={18} /> Return or destroy</button>}
            {q && !can('batch.decide') && <Note tone="violet">A pharmacist decides what happens to stock on hold.</Note>}
            {batch.status !== 'disposed' && can('stock.write') && <button className="btn soft block" onClick={() => setMode('count')}><ClipboardCheck size={18} /> Count this batch</button>}
            {batch.status !== 'disposed' && can('stock.write') && <button className="btn soft block" onClick={() => setMode('move')}><MoveRight size={18} /> Move to another shelf</button>}
          </div>
        )}

        {mode === 'quarantine' && (
          <div className="stack">
            <Field label="Why is it coming off sale?">
              <select className="select" value={reason} onChange={(e) => setReason(e.target.value as QReason)}>
                {(Object.keys(REASON_LABEL) as QReason[]).filter((r) => r !== 'failed_check').map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
              </select>
            </Field>
            <Field label="Anything to add? (optional)"><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <Note tone="violet">After this, carry the packs to the <b>quarantine shelf</b> and label them "Do not sell".</Note>
            <div className="row"><button className="btn soft" onClick={() => setMode(null)}>Back</button><button className="btn next grow" disabled={act.isPending} onClick={() => act.mutate('quarantine')}>Take off sale</button></div>
          </div>
        )}

        {mode === 'count' && (
          <div className="stack">
            <Field label={`How many ${batch.unit} did you count?`} hint={`The system has ${batch.quantity}`}>
              <input className="input mono" inputMode="numeric" autoFocus value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.]/g, ''))} style={{ fontSize: '1.4rem', height: 58 }} />
            </Field>
            {diff !== 0 && Number.isFinite(diff) && (
              <>
                <Note tone="amber">That's <b>{diff > 0 ? `${diff} more` : `${-diff} fewer`}</b> than the system. Say why.</Note>
                <Field label="Why is it different?" hint="e.g. broken bottle, miscounted last delivery"><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              </>
            )}
            <div className="row"><button className="btn soft" onClick={() => setMode(null)}>Back</button><button className="btn next grow" disabled={act.isPending || counted === '' || (diff !== 0 && !note.trim())} onClick={() => act.mutate('count')}>Save count</button></div>
          </div>
        )}

        {mode === 'move' && (
          <div className="stack">
            <Field label="New shelf">
              <select className="select" value={shelf} onChange={(e) => setShelf(e.target.value)}>
                <option value="">No shelf</option>{(shelves ?? []).filter((s) => s.kind !== 'quarantine').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <div className="row"><button className="btn soft" onClick={() => setMode(null)}>Back</button><button className="btn next grow" disabled={act.isPending} onClick={() => act.mutate('move')}>Move</button></div>
          </div>
        )}

        {mode === 'dispose' && (
          <div className="stack">
            <div className="stack tight">
              <button type="button" className={`pay-method ${how === 'returned_to_supplier' ? 'on' : ''}`} onClick={() => setHow('returned_to_supplier')}>
                <div className="t"><Undo2 size={16} /> Returned to the supplier</div>
                <div className="s">{batch.supplier_name ? `${batch.supplier_name}${batch.accepts_returns === false ? ' says it does not take returns' : batch.return_window_days ? ` takes returns up to ${batch.return_window_days} days before expiry` : ''}` : 'No supplier recorded'}</div>
              </button>
              <button type="button" className={`pay-method ${how === 'destroyed' ? 'on' : ''}`} onClick={() => setHow('destroyed')}>
                <div className="t"><Trash2 size={16} /> Destroyed</div>
                <div className="s">Keep the destruction certificate or witness name</div>
              </button>
            </div>
            <Field label={how === 'destroyed' ? 'Witness / certificate number' : 'Return note or credit note number'}><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <Note tone="red">This removes {batch.quantity} {batch.unit} from stock for good.</Note>
            <div className="row"><button className="btn soft" onClick={() => setMode(null)}>Back</button><button className="btn danger grow" disabled={act.isPending || !note.trim()} onClick={() => act.mutate('dispose')}>Record and remove</button></div>
          </div>
        )}
      </div>
    </Sheet>
  )
}
