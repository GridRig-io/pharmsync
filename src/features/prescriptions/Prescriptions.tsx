import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, FileText, Image as ImageIcon, Repeat } from 'lucide-react'
import { supabase, q, friendlyError } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useStaffList, useStock } from '../../lib/data'
import { useToast } from '../../lib/toast'
import { addDays, daysUntil, fmtDate, fmtWhen, medLabel, todayISO, CLASS_LABEL } from '../../lib/format'
import type { MedClass, RxItem } from '../../lib/types'
import { Chips, Empty, Help, Note, PageHead, Seg, Sheet, SkeletonRows, Tag } from '../../components/ui'
import { RxSheet } from './RxSheet'

interface Rx { id: string; patient_name: string; patient_age: number | null; patient_sex: string | null; patient_phone: string | null; prescriber_name: string; prescriber_mdcn: string; facility: string | null; date_written: string; is_repeat: boolean; photo_path: string | null; signed_by: string; signed_at: string; notes: string | null }

export default function Prescriptions() {
  const { staff, pharmacy } = useSession()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'list' ? 'list' : 'recorded'
  const [creating, setCreating] = useState(params.get('new') != null)
  const [open, setOpen] = useState<Rx | null>(null)
  const recent = useQuery({
    queryKey: ['rx', 'recent'],
    queryFn: () => q<Rx[]>(supabase.from('ph_prescriptions').select('*').gte('signed_at', addDays(todayISO(), -30)).order('signed_at', { ascending: false }).limit(100)),
  })
  const today = (recent.data ?? []).filter((r) => fmtWhen(r.signed_at).startsWith('Today'))
  return (
    <div className="page stack">
      <PageHead title="Prescriptions" sub={`New ones can be filled for ${pharmacy?.rx_valid_days ?? 7} days, repeats for ${pharmacy?.rx_repeat_valid_days ?? 30} days.`}
        actions={<button className="btn next" onClick={() => setCreating(true)}><Plus size={18} /> Record prescription</button>} />
      <Seg value={tab} onChange={(v) => setParams(v === 'list' ? { tab: 'list' } : {}, { replace: true })} options={[
        { value: 'recorded', label: `Recorded${today.length ? ` · ${today.length} today` : ''}` },
        { value: 'list', label: 'Prescription-only list' },
      ]} />
      {tab === 'recorded' ? (
        recent.isLoading ? <SkeletonRows /> : (recent.data ?? []).length === 0 ? (
          <div className="card"><Empty icon={<FileText size={28} />} text="No prescriptions in the last 30 days." /></div>
        ) : (
          <div className="card flush"><div className="list">
            {recent.data!.map((r) => {
              const until = pharmacy ? addDays(r.date_written, r.is_repeat ? pharmacy.rx_repeat_valid_days : pharmacy.rx_valid_days) : null
              const left = daysUntil(until)
              return (
                <button key={r.id} className="li" onClick={() => setOpen(r)}>
                  <span className="chip-ic ic-violet"><FileText size={18} /></span>
                  <div className="grow">
                    <div className="t">{r.patient_name}</div>
                    <div className="s">{r.prescriber_name} · {fmtWhen(r.signed_at)}</div>
                  </div>
                  {r.is_repeat && <Tag tone="blue"><Repeat size={12} /> Repeat</Tag>}
                  {left != null && (left < 0 ? <Tag>Closed</Tag> : <Tag tone="green">until {fmtDate(until, { day: 'numeric', month: 'short' })}</Tag>)}
                </button>
              )
            })}
          </div></div>
        )
      ) : <RxOnlyList isAdmin={staff?.role === 'admin'} />}
      {creating && <RxSheet onClose={() => { setCreating(false); if (params.get('new') != null) setParams({}, { replace: true }) }} />}
      {open && <RxDetail rx={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function RxOnlyList({ isAdmin }: { isAdmin: boolean }) {
  const { data, isLoading } = useStock()
  const qc = useQueryClient(); const toast = useToast()
  const [term, setTerm] = useState('')
  const [show, setShow] = useState<'rx' | 'all'>('rx')
  const rows = useMemo(() => {
    const t = term.trim().toLowerCase()
    return (data ?? []).filter((m) => (show === 'all' || m.class !== 'otc') && (!t || [m.name, m.brand].some((x) => x?.toLowerCase().includes(t))))
  }, [data, term, show])
  const change = useMutation({
    mutationFn: async ({ id, cls }: { id: string; cls: MedClass }) => {
      const { error } = await supabase.from('ph_medicines').update({ class: cls }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ['stock'] }); toast(`Now ${CLASS_LABEL[v.cls].toLowerCase()}`) },
    onError: (e) => toast(friendlyError(e), { tone: 'error' }),
  })
  return (
    <div className="stack">
      <Note tone="violet">
        These medicines are <b>locked at the till</b> until a prescription is recorded.
        {isAdmin ? ' As superintendent pharmacist you can change which ones.' : ' Only the superintendent pharmacist can change this list.'}{' '}
        <Help>Follow the PCN and NAFDAC classification. Antibiotics, antihypertensives, antidiabetics and injections are usually prescription-only. Opioids like tramadol, codeine and pethidine are controlled.</Help>
      </Note>
      <div className="row">
        <div className="input-ic grow"><Search size={18} /><input className="input" placeholder="Search" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
      </div>
      {isAdmin && <Chips value={show} onChange={setShow} options={[{ value: 'rx', label: 'Rx only and controlled' }, { value: 'all', label: 'All medicines' }]} />}
      {isLoading ? <SkeletonRows /> : rows.length === 0 ? <div className="card"><Empty text="No prescription-only medicines yet." /></div> : (
        <div className="card flush"><div className="list">
          {rows.map((m) => (
            <div key={m.id} className="li" style={{ cursor: 'default', flexWrap: 'wrap' }}>
              <div className="grow" style={{ minWidth: 180 }}><div className="t">{medLabel(m)}</div><div className="s">{m.brand ?? ''}{m.nafdac_no ? ` · NAFDAC ${m.nafdac_no}` : ''}</div></div>
              {isAdmin ? (
                <div style={{ width: 280 }}>
                  <Seg value={m.class} onChange={(cls) => cls !== m.class && change.mutate({ id: m.id, cls })} options={[{ value: 'otc', label: 'OTC' }, { value: 'pom', label: 'Rx only' }, { value: 'controlled', label: 'Controlled' }]} />
                </div>
              ) : <Tag tone="violet">{CLASS_LABEL[m.class]}</Tag>}
            </div>
          ))}
        </div></div>
      )}
    </div>
  )
}

function RxDetail({ rx, onClose }: { rx: Rx; onClose: () => void }) {
  const { data: team } = useStaffList()
  const items = useQuery({ queryKey: ['rx', 'items', rx.id], queryFn: () => q<RxItem[]>(supabase.from('ph_rx_items').select('*').eq('prescription_id', rx.id)) })
  const photo = useQuery({
    queryKey: ['rx', 'photo', rx.photo_path], enabled: !!rx.photo_path,
    queryFn: async () => (await supabase.storage.from('ph-prescriptions').createSignedUrl(rx.photo_path!, 600)).data?.signedUrl ?? null,
  })
  const signer = team?.find((s) => s.id === rx.signed_by)
  return (
    <Sheet open onClose={onClose} title={rx.patient_name}>
      <div className="stack loose">
        <div className="card stack tight small">
          <div className="spread"><span className="muted">Patient</span><b>{[rx.patient_name, rx.patient_age != null && `${rx.patient_age} y`, rx.patient_sex].filter(Boolean).join(' · ')}</b></div>
          {rx.patient_phone && <div className="spread"><span className="muted">Phone</span><b className="mono">{rx.patient_phone}</b></div>}
          <div className="spread"><span className="muted">Prescriber</span><b>{rx.prescriber_name}</b></div>
          <div className="spread"><span className="muted">MDCN</span><b className="mono">{rx.prescriber_mdcn}</b></div>
          {rx.facility && <div className="spread"><span className="muted">Facility</span><b>{rx.facility}</b></div>}
          <div className="spread"><span className="muted">Written</span><b>{fmtDate(rx.date_written)}{rx.is_repeat ? ' · repeat' : ''}</b></div>
          <div className="spread"><span className="muted">Signed by</span><b>{signer?.full_name ?? '—'}{signer?.pcn_reg_no ? ` (PCN ${signer.pcn_reg_no})` : ''}</b></div>
          <div className="spread"><span className="muted">When</span><b>{fmtWhen(rx.signed_at)}</b></div>
        </div>
        <div className="card flush"><div className="list">
          {(items.data ?? []).map((i) => (
            <div key={i.id} className="li" style={{ cursor: 'default' }}>
              <div className="grow"><div className="t">{i.medicine_name}{i.strength ? ` ${i.strength}` : ''}</div><div className="s">{i.directions ?? 'No directions written'}</div></div>
              <Tag tone={Number(i.remaining) > 0 ? 'violet' : 'grey'}>{i.qty_dispensed} of {i.qty_prescribed} {i.unit} given</Tag>
            </div>
          ))}
        </div></div>
        {rx.photo_path && (photo.data ? <a href={photo.data} target="_blank" rel="noreferrer"><img src={photo.data} alt="Photo of the prescription" style={{ borderRadius: 14, border: '1px solid var(--rule)' }} /></a> : <div className="row small muted"><ImageIcon size={16} /> Loading photo…</div>)}
        {rx.notes && <Note>{rx.notes}</Note>}
      </div>
    </Sheet>
  )
}
