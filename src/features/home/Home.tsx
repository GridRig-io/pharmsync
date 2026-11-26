import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Snowflake, Thermometer, Lock, PauseCircle, CalendarClock, ScanLine, PackagePlus, FileText, Siren, PackageX, Check, ChevronRight } from 'lucide-react'
import { supabase, q, friendlyError } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useNeeds, markCheck } from '../../lib/data'
import { useToast } from '../../lib/toast'
import { fmtDate, fmtTime, money, startOfTodayISO, todayISO } from '../../lib/format'
import type { CheckKey } from '../../lib/types'
import { TempSheet } from '../../components/TempSheet'
import { Help, SecHead, Sheet, Note } from '../../components/ui'

const CHECKS: { key: CheckKey; title: string; sub: string; icon: typeof Snowflake; tone: string; help: string; who?: 'pharmacist' }[] = [
  { key: 'fridge', title: 'Fridge temperature', sub: 'Read the thermometer, write it down', icon: Snowflake, tone: 'blue',
    help: 'Insulin, vaccines and some eye drops must stay between 2 and 8 °C. Check it every morning before you open.' },
  { key: 'room', title: 'Room temperature', sub: 'Most medicines need below 25 °C', icon: Thermometer, tone: 'amber',
    help: 'Heat ruins tablets and syrups. If the shop is too hot, tell the pharmacist and turn on the AC.' },
  { key: 'controlled', title: 'Count the locked cabinet', sub: 'Controlled medicines must match the book', icon: Lock, tone: 'violet', who: 'pharmacist',
    help: 'Pethidine, tramadol, codeine and similar medicines are counted every day. A pharmacist does this.' },
  { key: 'quarantine', title: 'Look at the quarantine shelf', sub: 'Nothing on hold has moved back to sale', icon: PauseCircle, tone: 'violet',
    help: 'Expired, damaged or recalled stock waits on the quarantine shelf until a pharmacist returns or destroys it. It must never be sold.' },
  { key: 'expiry', title: 'Pull short-dated stock', sub: 'Anything with 30 days or less goes to the front', icon: CalendarClock, tone: 'orange',
    help: 'Sell the oldest first (First Expiry, First Out). Anything already expired goes to quarantine.' },
]

export function Home() {
  const { staff, pharmacy, can } = useSession()
  const { data: needs } = useNeeds()
  const nav = useNavigate(); const qc = useQueryClient(); const toast = useToast()
  const [temp, setTemp] = useState<null | 'fridge' | 'room'>(null)
  const [ask, setAsk] = useState<null | CheckKey>(null)

  const { data: sales } = useQuery({
    queryKey: ['sales', 'today-total'],
    queryFn: () => q<{ total: number }[]>(supabase.from('ph_sales').select('total').eq('status', 'paid').gte('created_at', startOfTodayISO())),
  })
  const done = new Map((needs?.checks ?? []).map((c) => [c.check_key, c]))
  const next = CHECKS.find((c) => !done.has(c.key) && (c.who !== 'pharmacist' || can('controlled')))
  const mark = useMutation({
    mutationFn: (k: CheckKey) => markCheck(k),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['home'] }); setAsk(null); toast('Done. Thank you.') },
    onError: (e) => toast(friendlyError(e), { tone: 'error' }),
  })

  const start = (k: CheckKey) => {
    if (k === 'fridge' || k === 'room') setTemp(k)
    else if (k === 'controlled') nav('/controlled?count=1')
    else setAsk(k)
  }

  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: pharmacy?.timezone }).format(new Date()))
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const first = staff?.full_name?.split(/\s+/)[0] ?? ''
  const todayTotal = (sales ?? []).reduce((s, x) => s + Number(x.total), 0)

  const items = [
    needs?.recalls ? { to: '/recalls', icon: Siren, tone: 'red', t: `${needs.recalls} recall${needs.recalls > 1 ? 's' : ''} open`, s: 'Check the shelves for the recalled batch' } : null,
    needs?.expired ? { to: '/expiry?band=expired', icon: PackageX, tone: 'red', t: `${needs.expired} expired batch${needs.expired > 1 ? 'es' : ''} still on the shelf`, s: 'Move them to quarantine. They cannot be sold.' } : null,
    needs?.soon ? { to: '/expiry?band=30', icon: CalendarClock, tone: 'orange', t: `${needs.soon} batch${needs.soon > 1 ? 'es' : ''} expire within 30 days`, s: 'Sell these first or return them to the supplier' } : null,
    needs?.low ? { to: '/medicines?filter=low', icon: PackagePlus, tone: 'amber', t: `${needs.low} medicine${needs.low > 1 ? 's' : ''} low or out`, s: 'Add them to the next order' } : null,
    needs?.quarantine && can('batch.decide') ? { to: '/expiry?tab=quarantine', icon: PauseCircle, tone: 'violet', t: `${needs.quarantine} batch${needs.quarantine > 1 ? 'es' : ''} waiting on the quarantine shelf`, s: 'Return to supplier, destroy, or put back' } : null,
  ].filter(Boolean) as { to: string; icon: typeof Siren; tone: string; t: string; s: string }[]

  return (
    <div className="page stack">
      <div>
        <div className="kicker">{fmtDate(todayISO(), { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <h1 className="h1">{hello}{first ? `, ${first}` : ''}</h1>
      </div>

      {next ? (
        <button className="next-step" onClick={() => start(next.key)}>
          <div className="grow"><div className="eyebrow">Next step</div><div className="t">{next.title}</div></div>
          <ChevronRight size={22} />
        </button>
      ) : (
        <Note tone="green" icon={<Check size={18} />}>Opening checks are done for today.</Note>
      )}

      <div className="grid-auto stack">
        <section>
          <SecHead title="Opening checks" count={CHECKS.filter((c) => done.has(c.key)).length} action={<span className="small muted">of {CHECKS.length}</span>} />
          <div className="card flush"><div className="list">
            {CHECKS.map((c) => {
              const d = done.get(c.key)
              const blocked = c.who === 'pharmacist' && !can('controlled')
              return (
                <div key={c.key} className="li" style={{ cursor: 'default' }}>
                  <span className={`chip-ic ic-${d ? 'green' : c.tone}`}>{d ? <Check size={20} /> : <c.icon size={20} />}</span>
                  <div className="grow">
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><span className="t">{c.title}</span><Help>{c.help}</Help></div>
                    <div className="s">{d ? `Done at ${fmtTime(d.done_at)}` : blocked ? 'A pharmacist does this one' : c.sub}</div>
                  </div>
                  {!d && !blocked && <button className="btn sm" onClick={() => start(c.key)}>{c.key === 'fridge' || c.key === 'room' ? 'Log' : 'Start'}</button>}
                </div>
              )
            })}
          </div></div>
        </section>

        <section>
          <SecHead title="Needs you" count={items.length} />
          {items.length ? (
            <div className="card flush"><div className="list">
              {items.map((i) => (
                <Link key={i.to} to={i.to} className="li">
                  <span className={`chip-ic ic-${i.tone}`}><i.icon size={20} /></span>
                  <div className="grow"><div className="t">{i.t}</div><div className="s">{i.s}</div></div>
                  <ChevronRight className="chev" size={18} />
                </Link>
              ))}
            </div></div>
          ) : <div className="card muted small">Nothing waiting. Shelves look good.</div>}

          <SecHead title="Quick actions" />
          <div className="grid2">
            <Link to="/sell" className="card stack tight" style={{ textDecoration: 'none' }}><span className="chip-ic ic-pine"><ScanLine size={20} /></span><span className="b">Sell</span><span className="xs muted">Scan and take payment</span></Link>
            {can('stock.write') && <Link to="/receive" className="card stack tight" style={{ textDecoration: 'none' }}><span className="chip-ic ic-green"><PackagePlus size={20} /></span><span className="b">Receive delivery</span><span className="xs muted">Check, then shelve</span></Link>}
            <Link to="/prescriptions?new=1" className="card stack tight" style={{ textDecoration: 'none' }}><span className="chip-ic ic-violet"><FileText size={20} /></span><span className="b">Record prescription</span><span className="xs muted">Needed for Rx-only</span></Link>
            <button className="card stack tight" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setTemp('fridge')}><span className="chip-ic ic-blue"><Snowflake size={20} /></span><span className="b">Log temperature</span><span className="xs muted">Fridge or room</span></button>
          </div>

          <SecHead title="Today" />
          <Link to="/sales" className="card spread" style={{ textDecoration: 'none' }}>
            <div><div className="small muted">Sales today</div><div className="big">{money(todayTotal)}</div></div>
            <div className="small muted">{sales?.length ?? 0} receipt{sales?.length === 1 ? '' : 's'} <ChevronRight size={16} style={{ verticalAlign: 'middle' }} /></div>
          </Link>
        </section>
      </div>

      {temp && <TempSheet initial={temp} onClose={() => setTemp(null)} />}
      {ask && (
        <Sheet open onClose={() => setAsk(null)} title={CHECKS.find((c) => c.key === ask)!.title}
          footer={<>
            {ask === 'expiry' && <Link to="/expiry" className="btn soft" onClick={() => setAsk(null)}>Open expiry board</Link>}
            <button className="btn next grow" disabled={mark.isPending} onClick={() => mark.mutate(ask)}>Yes, done</button>
          </>}>
          {ask === 'quarantine' ? (
            <div className="stack">
              <p>Go to the <b>quarantine shelf</b>. Check that:</p>
              <ul className="stack tight" style={{ margin: 0, paddingLeft: 20 }}>
                <li>everything on it has a red "Do not sell" label,</li>
                <li>nothing from it has been put back on a sales shelf,</li>
                <li>it is out of the customers' reach.</li>
              </ul>
              <p className="small muted">{needs?.quarantine ?? 0} batch(es) should be there now.</p>
            </div>
          ) : (
            <div className="stack">
              <p>Walk the shelves. For anything expiring in <b>30 days or less</b>, put it at the front so it sells first.</p>
              <p>Anything already <b>expired</b>: open the expiry board and move it to quarantine.</p>
              <p className="small muted">{needs?.soon ?? 0} batch(es) expire within 30 days, {needs?.expired ?? 0} already expired.</p>
            </div>
          )}
        </Sheet>
      )}
    </div>
  )
}
