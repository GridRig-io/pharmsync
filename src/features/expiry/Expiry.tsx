import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarCheck, PauseCircle, Undo2 } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { addDays, fmtDate, REASON_LABEL, todayISO } from '../../lib/format'
import type { BatchRow } from '../../lib/types'
import { Empty, ErrorNote, Help, LabelCard, PageHead, Seg, SkeletonRows, Tag } from '../../components/ui'
import { BatchSheet } from '../../components/BatchSheet'

type Band = 'expired' | '30' | 'warn' | '180'

export default function Expiry() {
  const { pharmacy } = useSession()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'quarantine' ? 'quarantine' : 'ladder'
  const band = (params.get('band') as Band) ?? 'expired'
  const [batch, setBatch] = useState<BatchRow | null>(null)
  const warn = pharmacy?.expiry_warning_days ?? 90

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['batches', 'expiry'],
    queryFn: () => q<BatchRow[]>(supabase.from('ph_batch_overview').select('*').in('status', ['available', 'quarantine']).gt('quantity', 0)
      .lte('expiry_date', addDays(todayISO(), 180)).order('expiry_date')),
  })
  const held = useQuery({
    queryKey: ['batches', 'quarantine'],
    queryFn: () => q<BatchRow[]>(supabase.from('ph_batch_overview').select('*').eq('status', 'quarantine').gt('quantity', 0).order('quarantined_at', { ascending: false })),
  })

  const avail = useMemo(() => (data ?? []).filter((b) => b.status === 'available'), [data])
  const bands: { key: Band; t: string; s: string; color: string; rows: BatchRow[] }[] = [
    { key: 'expired', t: 'Expired', s: 'Take off sale now', color: 'var(--red)', rows: avail.filter((b) => b.days_left < 0) },
    { key: '30', t: '30 days', s: 'Sell first / return', color: 'var(--red)', rows: avail.filter((b) => b.days_left >= 0 && b.days_left <= 30) },
    { key: 'warn', t: `${warn} days`, s: 'Watch', color: 'var(--orange)', rows: avail.filter((b) => b.days_left > 30 && b.days_left <= warn) },
    { key: '180', t: '6 months', s: 'Plan ahead', color: '#E8B200', rows: avail.filter((b) => b.days_left > warn && b.days_left <= 180) },
  ]
  const current = bands.find((b) => b.key === band) ?? bands[0]!
  const set = (p: Record<string, string>) => setParams(p, { replace: true })

  return (
    <div className="page stack">
      <PageHead title="Expiry and quarantine" sub="First expiry, first out: the till always sells the oldest batch first." />
      <Seg value={tab} onChange={(v) => set(v === 'quarantine' ? { tab: 'quarantine' } : {})} options={[
        { value: 'ladder', label: 'Expiry ladder' },
        { value: 'quarantine', label: `On hold${held.data?.length ? ` · ${held.data.length}` : ''}` },
      ]} />

      {tab === 'ladder' ? (
        <>
          <div className="ladder">
            {bands.map((b) => (
              <button key={b.key} className={`rung ${b.key === current.key ? 'on' : ''}`} onClick={() => set({ band: b.key })}>
                <span className="band" style={{ background: b.color }} />
                <b>{b.rows.length}</b><span className="t">{b.t}</span><span className="s">{b.s}</span>
              </button>
            ))}
          </div>
          {error ? <ErrorNote error={error} retry={refetch} /> : isLoading ? <SkeletonRows /> : current.rows.length === 0 ? (
            <div className="card"><Empty icon={<CalendarCheck size={28} />} text={current.key === 'expired' ? 'Nothing expired on the shelves.' : 'Nothing in this band.'} /></div>
          ) : (
            <div className="stack">
              {current.key === 'expired' && <p className="small c-red b">These cannot be sold. Tap each one and take it off sale.</p>}
              {current.rows.map((b) => {
                const returnBy = b.accepts_returns && b.return_window_days != null ? addDays(b.expiry_date, -b.return_window_days) : null
                const canReturn = returnBy && returnBy >= todayISO()
                return (
                  <LabelCard key={b.id} daysLeft={b.days_left} warnDays={warn} onClick={() => setBatch(b)}>
                    <span className="b">{b.medicine_name}{b.strength ? ` ${b.strength}` : ''}</span>
                    <span className="small muted"><span className="mono">{b.batch_no}</span> · {b.quantity} {b.unit} · {b.shelf_name ?? 'no shelf'}</span>
                    <span className="small muted">Expires {fmtDate(b.expiry_date)}</span>
                    {canReturn && <span><Tag tone="pine"><Undo2 size={12} /> {b.supplier_name} takes it back until {fmtDate(returnBy)}</Tag></span>}
                  </LabelCard>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="row small muted" style={{ gap: 6 }}>Stock on hold is never sold. <Help>Expired, damaged, recalled or suspect stock waits here. A pharmacist either puts it back (if it was a mistake), returns it to the supplier, or destroys it with a witness.</Help></div>
          {held.isLoading ? <SkeletonRows /> : (held.data ?? []).length === 0 ? (
            <div className="card"><Empty icon={<PauseCircle size={28} />} text="The quarantine shelf is empty." /></div>
          ) : (
            <div className="stack">
              {held.data!.map((b) => (
                <LabelCard key={b.id} daysLeft={b.days_left} warnDays={warn} quarantine onClick={() => setBatch(b)}>
                  <span className="b">{b.medicine_name}{b.strength ? ` ${b.strength}` : ''}</span>
                  <span className="small muted"><span className="mono">{b.batch_no}</span> · {b.quantity} {b.unit} · expires {fmtDate(b.expiry_date)}</span>
                  {b.quarantine_reason && <span><Tag tone="violet">{REASON_LABEL[b.quarantine_reason]}</Tag></span>}
                </LabelCard>
              ))}
            </div>
          )}
        </>
      )}
      {batch && <BatchSheet batch={batch} onClose={() => setBatch(null)} />}
    </div>
  )
}
