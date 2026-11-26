import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Snowflake, Thermometer } from 'lucide-react'
import { supabase, friendlyError } from '../lib/supabase'
import { useSession } from '../lib/session'
import { useShelves, markCheck } from '../lib/data'
import { useToast } from '../lib/toast'
import { Field, Seg, Sheet, Note } from './ui'

export function TempSheet({ onClose, initial = 'fridge' }: { onClose: () => void; initial?: 'fridge' | 'room' }) {
  const { pharmacy } = useSession()
  const { data: shelves } = useShelves()
  const fridges = (shelves ?? []).filter((s) => s.kind === 'fridge')
  const [kind, setKind] = useState<'fridge' | 'room'>(initial)
  const [shelf, setShelf] = useState<string>('')
  const [reading, setReading] = useState('')
  const [action, setAction] = useState('')
  const qc = useQueryClient(); const toast = useToast()

  const value = parseFloat(reading.replace(',', '.'))
  const has = Number.isFinite(value)
  const min = kind === 'fridge' ? Number(pharmacy?.fridge_min_c ?? 2) : -40
  const max = kind === 'fridge' ? Number(pharmacy?.fridge_max_c ?? 8) : Number(pharmacy?.room_max_c ?? 25)
  const out = has && (value < min || value > max)
  const shelfId = kind === 'fridge' ? (shelf || fridges[0]?.id || null) : null

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('ph_temperature_logs').insert({ kind, shelf_id: shelfId, reading_c: value, action_taken: action.trim() || null })
      if (error) throw error
      await markCheck(kind)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['home'] }); qc.invalidateQueries({ queryKey: ['temps'] })
      toast(out ? 'Reading saved with your action' : 'Reading saved. In range.'); onClose()
    },
    onError: (e) => toast(friendlyError(e), { tone: 'error' }),
  })

  return (
    <Sheet open onClose={onClose} title="Log a temperature"
      footer={<button className="btn next lg block" disabled={!has || (out && !action.trim()) || save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? 'Saving…' : 'Save reading'}</button>}>
      <div className="stack loose">
        <Seg value={kind} onChange={setKind} options={[
          { value: 'fridge', label: <span className="row" style={{ justifyContent: 'center', gap: 6 }}><Snowflake size={16} /> Fridge</span> },
          { value: 'room', label: <span className="row" style={{ justifyContent: 'center', gap: 6 }}><Thermometer size={16} /> Room</span> },
        ]} />
        {kind === 'fridge' && fridges.length > 1 && (
          <Field label="Which fridge">
            <select className="select" value={shelfId ?? ''} onChange={(e) => setShelf(e.target.value)}>
              {fridges.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="What does the thermometer say? (°C)" hint={kind === 'fridge' ? `Should be ${min} to ${max} °C` : `Should be below ${max} °C`}
          help="Read the number on the thermometer now. Vaccines and insulin spoil if the fridge goes outside 2 to 8 °C.">
          <input className="input mono" inputMode="decimal" autoFocus value={reading} onChange={(e) => setReading(e.target.value)} placeholder="e.g. 5" style={{ fontSize: '1.6rem', height: 64 }} />
        </Field>
        {has && !out && <Note tone="green">In range. Nothing else to do.</Note>}
        {out && (
          <>
            <Note tone="red"><b>Out of range.</b> Don't sell cold-chain items from here until a pharmacist checks them. Tell the pharmacist on duty now.</Note>
            <Field label="What did you do about it?" hint="For example: moved the vaccines to Fridge 2, told Pharm. Ada">
              <textarea className="textarea" value={action} onChange={(e) => setAction(e.target.value)} />
            </Field>
          </>
        )}
      </div>
    </Sheet>
  )
}
