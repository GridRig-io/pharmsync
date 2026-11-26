import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera } from 'lucide-react'
import { supabase, friendlyError } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useShelves } from '../../lib/data'
import { useToast } from '../../lib/toast'
import { CLASS_LABEL } from '../../lib/format'
import type { MedClass, Medicine, Ven } from '../../lib/types'
import { Field, Seg, Sheet, Switch, Note } from '../../components/ui'
import { CameraScan } from '../../components/CameraScan'

const UNITS = ['box', 'pack', 'strip', 'bottle', 'tube', 'vial', 'ampoule', 'sachet', 'tablet', 'capsule', 'piece']
const FORMS = ['tablets', 'capsules', 'syrup', 'suspension', 'injection', 'cream', 'ointment', 'drops', 'inhaler', 'suppository', 'sachet', 'other']

export function MedicineSheet({ med, barcode, onClose, onSaved }: { med?: Medicine; barcode?: string; onClose: () => void; onSaved?: (id: string) => void }) {
  const { can, staff } = useSession()
  const { data: shelves } = useShelves()
  const qc = useQueryClient(); const toast = useToast()
  const [scan, setScan] = useState(false)
  const [f, setF] = useState({
    name: med?.name ?? '', strength: med?.strength ?? '', form: med?.form ?? 'tablets', brand: med?.brand ?? '',
    unit: med?.unit ?? 'box', units_per_pack: med?.units_per_pack?.toString() ?? '', barcode: med?.barcode ?? barcode ?? '',
    nafdac_no: med?.nafdac_no ?? '', greenbook_verified: med?.greenbook_verified ?? false,
    class: (med?.class ?? 'otc') as MedClass, ven: (med?.ven ?? 'essential') as Ven, lasa_note: med?.lasa_note ?? '',
    reorder_level: med?.reorder_level?.toString() ?? '5', max_level: med?.max_level?.toString() ?? '',
    sell_price: med?.sell_price?.toString() ?? '', cost_price: med?.cost_price?.toString() ?? '',
    default_shelf_id: med?.default_shelf_id ?? '', cold_chain: med?.cold_chain ?? false, notes: med?.notes ?? '', archived: med?.archived ?? false,
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  // Who may set the class: new → pharmacist for Rx/controlled; existing → admin only
  const classLocked = med ? staff?.role !== 'admin' : !can('rx.sign')

  const save = useMutation({
    mutationFn: async () => {
      const n = (s: string) => (s.trim() === '' ? null : Number(s.replace(/,/g, '')))
      const row = {
        name: f.name.trim(), strength: f.strength.trim() || null, form: f.form || null, brand: f.brand.trim() || null,
        unit: f.unit, units_per_pack: n(f.units_per_pack), barcode: f.barcode.trim() || null, nafdac_no: f.nafdac_no.trim().toUpperCase() || null,
        greenbook_verified: f.greenbook_verified, ven: f.ven, lasa_note: f.lasa_note.trim() || null,
        reorder_level: n(f.reorder_level) ?? 0, max_level: n(f.max_level), sell_price: n(f.sell_price) ?? 0, cost_price: n(f.cost_price),
        default_shelf_id: f.default_shelf_id || null, cold_chain: f.cold_chain, notes: f.notes.trim() || null, archived: f.archived,
        ...(med && med.class === f.class ? {} : { class: f.class }),
      }
      if (!row.name) throw new Error('Enter the medicine name')
      if (med) {
        const { error } = await supabase.from('ph_medicines').update(row).eq('id', med.id)
        if (error) throw error
        return med.id
      }
      const { data, error } = await supabase.from('ph_medicines').insert(row).select('id').single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['stock'] }); qc.invalidateQueries({ queryKey: ['medicine'] })
      toast(med ? 'Saved' : 'Medicine added'); onSaved?.(id); onClose()
    },
    onError: (e) => toast(friendlyError(e), { tone: 'error' }),
  })

  return (
    <Sheet open onClose={onClose} title={med ? 'Edit medicine' : 'Add a medicine'} wide
      footer={<><button className="btn soft" onClick={onClose}>Cancel</button><button className="btn next grow" disabled={save.isPending || !f.name.trim()} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save medicine'}</button></>}>
      <div className="stack loose">
        <Field label="Generic name" hint="The active ingredient, e.g. Amoxicillin"><input className="input" autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <div className="grid2">
          <Field label="Strength"><input className="input" placeholder="500 mg" value={f.strength} onChange={(e) => set('strength', e.target.value)} /></Field>
          <Field label="Form"><select className="select" value={f.form} onChange={(e) => set('form', e.target.value)}>{FORMS.map((x) => <option key={x}>{x}</option>)}</select></Field>
        </div>
        <Field label="Brand (optional)"><input className="input" value={f.brand} onChange={(e) => set('brand', e.target.value)} /></Field>

        <Field label="Does it need a prescription?" help={<>OTC: anyone can buy it. Rx only: needs a doctor's prescription before it is sold. Controlled: Rx only, kept in the locked cabinet and counted every day. {med && 'Only the superintendent pharmacist can change this.'}</>}>
          <Seg value={f.class} onChange={(v) => !classLocked && set('class', v)} options={(['otc', 'pom', 'controlled'] as const).map((c) => ({ value: c, label: c === 'otc' ? 'OTC' : c === 'pom' ? 'Rx only' : 'Controlled' }))} />
          <span className="hint">{CLASS_LABEL[f.class]}{classLocked && (med ? ' · locked: only the admin can change it' : ' · ask a pharmacist to add Rx-only medicines')}</span>
        </Field>

        <div className="grid2">
          <Field label="Counted and sold as" help="The unit you count on the shelf and sell at the till."><select className="select" value={f.unit} onChange={(e) => set('unit', e.target.value)}>{UNITS.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Pieces inside (optional)" hint="e.g. 10 capsules"><input className="input mono" inputMode="numeric" value={f.units_per_pack} onChange={(e) => set('units_per_pack', e.target.value)} /></Field>
        </div>
        <div className="grid2">
          <Field label="Selling price (₦)"><input className="input mono" inputMode="decimal" value={f.sell_price} onChange={(e) => set('sell_price', e.target.value)} /></Field>
          <Field label="Cost price (₦)"><input className="input mono" inputMode="decimal" value={f.cost_price} onChange={(e) => set('cost_price', e.target.value)} /></Field>
        </div>
        <div className="grid2">
          <Field label="Reorder when down to" help="When stock falls to this number, it shows as Low on Home."><input className="input mono" inputMode="numeric" value={f.reorder_level} onChange={(e) => set('reorder_level', e.target.value)} /></Field>
          <Field label="Most to keep (optional)"><input className="input mono" inputMode="numeric" value={f.max_level} onChange={(e) => set('max_level', e.target.value)} /></Field>
        </div>

        <Field label="Barcode">
          <div className="row">
            <input className="input mono grow" value={f.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder="Scan or type" />
            <button type="button" className="icon-btn" aria-label="Scan with camera" onClick={() => setScan(true)}><Camera size={20} /></button>
          </div>
        </Field>
        <div className="grid2">
          <Field label="NAFDAC number" help="Printed on the pack, e.g. A4-1234. Check it on the NAFDAC Greenbook if unsure."><input className="input mono" value={f.nafdac_no} onChange={(e) => set('nafdac_no', e.target.value)} /></Field>
          <Field label="VEN" help="Vital: never run out (e.g. insulin, ORS). Essential: keep in stock. Non-essential: nice to have."><select className="select" value={f.ven} onChange={(e) => set('ven', e.target.value as Ven)}><option value="vital">Vital</option><option value="essential">Essential</option><option value="non_essential">Non-essential</option></select></Field>
        </div>
        <div className="spread"><span className="small b">Checked on NAFDAC Greenbook</span><Switch on={f.greenbook_verified} onChange={(v) => set('greenbook_verified', v)} label="Checked on NAFDAC Greenbook" /></div>
        <div className="spread"><span className="small b">Keep in the fridge (2–8 °C)</span><Switch on={f.cold_chain} onChange={(v) => set('cold_chain', v)} label="Keep in the fridge" /></div>
        <Field label="Usual shelf">
          <select className="select" value={f.default_shelf_id} onChange={(e) => set('default_shelf_id', e.target.value)}>
            <option value="">Choose…</option>{(shelves ?? []).filter((s) => s.kind !== 'quarantine').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Look-alike / sound-alike warning (optional)" hint="Shown at the till, e.g. “Not the same as Hydroxyzine”"><input className="input" value={f.lasa_note} onChange={(e) => set('lasa_note', e.target.value)} /></Field>
        <Field label="Notes"><textarea className="textarea" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        {med && (
          <div className="spread"><span className="small b">Stop using (hide from lists)</span><Switch on={f.archived} onChange={(v) => set('archived', v)} label="Archive" /></div>
        )}
        {f.class !== 'otc' && <Note tone="violet">This medicine will be blocked at the till until a prescription is recorded.</Note>}
      </div>
      {scan && <CameraScan onClose={() => setScan(false)} onCode={(c) => { set('barcode', c); setScan(false) }} />}
    </Sheet>
  )
}
