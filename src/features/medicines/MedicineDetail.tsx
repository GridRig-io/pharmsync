import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Pencil, ScanLine, PackagePlus, Snowflake, AlertTriangle, ShieldCheck } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useCart } from '../../lib/cart'
import { useToast } from '../../lib/toast'
import { CLASS_LABEL, fmtWhen, money, VEN_LABEL, fmtDate } from '../../lib/format'
import type { BatchRow, StockRow } from '../../lib/types'
import { ClassTag, ErrorNote, LabelCard, Meter, Note, SecHead, SkeletonRows, Tag, Empty } from '../../components/ui'
import { BatchSheet } from '../../components/BatchSheet'
import { MedicineSheet } from './MedicineSheet'

interface Move { id: string; type: string; quantity_delta: number; reason: string | null; balance_after: number | null; created_at: string; batch_id: string }

export default function MedicineDetail() {
  const { id } = useParams()
  const { can, pharmacy } = useSession()
  const nav = useNavigate(); const cart = useCart(); const toast = useToast()
  const [edit, setEdit] = useState(false)
  const [batch, setBatch] = useState<BatchRow | null>(null)
  const med = useQuery({ queryKey: ['medicine', id], queryFn: () => q<StockRow>(supabase.from('ph_stock').select('*').eq('id', id!).single()) })
  const batches = useQuery({
    queryKey: ['batches', 'med', id],
    queryFn: () => q<BatchRow[]>(supabase.from('ph_batch_overview').select('*').eq('medicine_id', id!).neq('status', 'disposed').gt('quantity', 0).order('expiry_date')),
  })
  const moves = useQuery({
    queryKey: ['medicine', id, 'moves'],
    queryFn: () => q<Move[]>(supabase.from('ph_movements').select('id,type,quantity_delta,reason,balance_after,created_at,batch_id').eq('medicine_id', id!).order('created_at', { ascending: false }).limit(15)),
  })
  if (med.error) return <div className="page"><ErrorNote error={med.error} retry={med.refetch} /></div>
  if (!med.data) return <div className="page"><SkeletonRows /></div>
  const m = med.data
  const warn = pharmacy?.expiry_warning_days ?? 90
  const sellFirst = (batches.data ?? []).find((b) => b.status === 'available' && b.days_left >= 0)

  const sell = () => {
    if (Number(m.on_hand) <= 0) return toast('Nothing on the shelf to sell', { tone: 'error' })
    cart.add({ medicine_id: m.id, name: [m.name, m.strength].filter(Boolean).join(' '), unit: m.unit, class: m.class, price: Number(m.sell_price), available: Number(m.on_hand), lasa_note: m.lasa_note })
    nav('/sell')
  }

  return (
    <div className="page stack">
      <Link to="/medicines" className="btn ghost sm" style={{ alignSelf: 'flex-start' }}><ArrowLeft size={16} /> Medicines</Link>
      <header className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><ClassTag cls={m.class} />{m.cold_chain && <Tag tone="blue"><Snowflake size={12} /> Fridge 2–8 °C</Tag>}{m.archived && <Tag>Archived</Tag>}</div>
          <h1 className="h1" style={{ marginTop: 6 }}>{m.name}{m.strength ? ` ${m.strength}` : ''}</h1>
          <p className="muted small">{[m.form, m.brand, m.nafdac_no && `NAFDAC ${m.nafdac_no}`].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="row wrap">
          {can('stock.write') && <button className="btn soft" onClick={() => setEdit(true)}><Pencil size={16} /> Edit</button>}
          {can('stock.write') && <Link className="btn soft" to={`/receive?medicine=${m.id}`}><PackagePlus size={16} /> Receive</Link>}
          <button className="btn next" onClick={sell}><ScanLine size={18} /> Sell</button>
        </div>
      </header>

      {m.lasa_note && <Note tone="amber" icon={<AlertTriangle size={18} />}><b>Look-alike warning:</b> {m.lasa_note}</Note>}
      {m.class !== 'otc' && <Note tone="violet">{CLASS_LABEL[m.class]}: the till won't sell this until a prescription is recorded{m.class === 'controlled' ? ', and every sale goes in the controlled register' : ''}.</Note>}

      <div className="grid-auto stack">
        <div className="card stack">
          <div className="spread">
            <div><div className="small muted">On the shelf, can be sold</div><div className="big">{m.on_hand} <span className="h3 muted">{m.unit}</span></div></div>
            <div style={{ textAlign: 'right' }}><div className="small muted">Price</div><div className="h2 mono">{money(m.sell_price)}</div></div>
          </div>
          <Meter value={Number(m.on_hand)} reorder={Number(m.reorder_level)} max={m.max_level} />
          <div className="spread small muted"><span>Reorder at {m.reorder_level}</span>{Number(m.quarantined) > 0 && <span className="c-violet b">{m.quarantined} on hold</span>}</div>
        </div>
        <div className="card stack tight small">
          <div className="spread"><span className="muted">Usual shelf</span><b>{m.shelf_name ?? '—'}</b></div>
          <div className="spread"><span className="muted">VEN</span><b>{VEN_LABEL[m.ven]}</b></div>
          <div className="spread"><span className="muted">Barcode</span><b className="mono">{m.barcode ?? '—'}</b></div>
          <div className="spread"><span className="muted">NAFDAC Greenbook</span>{m.greenbook_verified ? <span className="tag green"><ShieldCheck size={12} /> Checked</span> : <span className="tag amber">Not checked</span>}</div>
          {m.cost_price != null && <div className="spread"><span className="muted">Cost</span><b className="mono">{money(m.cost_price)}</b></div>}
        </div>
      </div>

      <SecHead title="Batches" count={batches.data?.length} action={<span className="small muted">Oldest expiry first</span>} />
      {batches.isLoading ? <SkeletonRows n={2} /> : (batches.data ?? []).length === 0 ? (
        <div className="card"><Empty text="No stock. Receive a delivery to add a batch." /></div>
      ) : (
        <div className="stack">
          {batches.data!.map((b) => (
            <LabelCard key={b.id} daysLeft={b.days_left} warnDays={warn} quarantine={b.status === 'quarantine'} pick={b.id === sellFirst?.id} onClick={() => setBatch(b)}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="b mono">{b.batch_no}</span>
                {b.id === sellFirst?.id && <span className="tag lime">SELL FIRST</span>}
                {b.days_left < 0 && b.status === 'available' && <Tag tone="red">Expired, take off sale</Tag>}
              </div>
              <span className="small muted">Expires {fmtDate(b.expiry_date)} · {b.quantity} {b.unit} · {b.shelf_name ?? 'no shelf'}</span>
            </LabelCard>
          ))}
        </div>
      )}

      <SecHead title="Recent movements" />
      <div className="card flush">
        {(moves.data ?? []).length === 0 ? <Empty text="Nothing yet." /> : (
          <table className="table">
            <thead><tr><th>When</th><th>What</th><th className="r">Change</th><th className="r">Left</th></tr></thead>
            <tbody>
              {moves.data!.map((mv) => (
                <tr key={mv.id}>
                  <td className="small">{fmtWhen(mv.created_at)}</td>
                  <td className="small"><b style={{ textTransform: 'capitalize' }}>{mv.type}</b>{mv.reason ? <span className="muted"> · {mv.reason}</span> : null}</td>
                  <td className={`r mono ${mv.quantity_delta < 0 ? 'c-red' : 'c-green'}`}>{mv.quantity_delta > 0 ? '+' : ''}{mv.quantity_delta}</td>
                  <td className="r mono">{mv.balance_after ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {edit && <MedicineSheet med={m} onClose={() => setEdit(false)} />}
      {batch && <BatchSheet batch={batch} onClose={() => setBatch(null)} />}
    </div>
  )
}
