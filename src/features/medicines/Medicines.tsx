import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search, Snowflake, Camera, Pill } from 'lucide-react'
import { useSession } from '../../lib/session'
import { useStock } from '../../lib/data'
import { daysUntil, fmtShort } from '../../lib/format'
import { Chips, ClassTag, Empty, ErrorNote, PageHead, SkeletonRows, StockTag } from '../../components/ui'
import { CameraScan } from '../../components/CameraScan'
import { MedicineSheet } from './MedicineSheet'

type Filter = 'all' | 'low' | 'rx' | 'controlled' | 'cold'

export default function Medicines() {
  const { can, pharmacy } = useSession()
  const [params, setParams] = useSearchParams()
  const [term, setTerm] = useState('')
  const [scan, setScan] = useState(false)
  const [adding, setAdding] = useState<string | null>(params.get('new') != null ? (params.get('barcode') ?? '') : null)
  const filter = (params.get('filter') as Filter) ?? 'all'
  const nav = useNavigate()
  const { data, isLoading, error, refetch } = useStock()

  const rows = useMemo(() => {
    const t = term.trim().toLowerCase()
    return (data ?? []).filter((m) => {
      if (filter === 'low' && m.stock_status === 'ok') return false
      if (filter === 'rx' && m.class !== 'pom') return false
      if (filter === 'controlled' && m.class !== 'controlled') return false
      if (filter === 'cold' && !m.cold_chain) return false
      if (!t) return true
      return m.barcode === term.trim() || [m.name, m.brand, m.strength, m.nafdac_no].some((x) => x?.toLowerCase().includes(t))
    })
  }, [data, term, filter])

  const onEnter = () => {
    if (rows.length === 1) nav(`/medicines/${rows[0]!.id}`)
    else if (rows.length === 0 && can('stock.write') && /^\d{6,}$/.test(term.trim())) setAdding(term.trim())
  }

  return (
    <div className="page">
      <PageHead title="Medicines" sub={data ? `${data.length} on the list` : undefined}
        actions={can('stock.write') && <button className="btn next" onClick={() => setAdding('')}><Plus size={18} /> Add medicine</button>} />
      <div className="stack">
        <div className="row">
          <div className="input-ic grow">
            <Search size={18} />
            <input className="input" placeholder="Search name, brand or scan a barcode" value={term} onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onEnter()} aria-label="Search medicines" />
          </div>
          <button className="icon-btn" aria-label="Scan with camera" onClick={() => setScan(true)}><Camera size={20} /></button>
        </div>
        <Chips value={filter} onChange={(v) => setParams(v === 'all' ? {} : { filter: v }, { replace: true })} options={[
          { value: 'all', label: 'All' }, { value: 'low', label: 'Low or out' }, { value: 'rx', label: 'Rx only' },
          { value: 'controlled', label: 'Controlled' }, { value: 'cold', label: 'Fridge' },
        ]} />
        {error ? <ErrorNote error={error} retry={refetch} /> : isLoading ? <SkeletonRows /> : rows.length === 0 ? (
          <div className="card"><Empty icon={<Pill size={28} />} title={term ? `Nothing matches “${term}”` : 'No medicines here yet'}
            text={can('stock.write') ? 'Add it, then receive the first delivery.' : 'Ask a pharmacist or inventory officer to add it.'}
            action={can('stock.write') && <button className="btn next" onClick={() => setAdding(/^\d{6,}$/.test(term.trim()) ? term.trim() : '')}><Plus size={18} /> Add medicine</button>} /></div>
        ) : (
          <div className="card flush"><div className="list">
            {rows.map((m) => {
              const d = daysUntil(m.nearest_expiry)
              return (
                <button key={m.id} className="li" onClick={() => nav(`/medicines/${m.id}`)}>
                  <div className="grow">
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <span className="t">{m.name}{m.strength ? ` ${m.strength}` : ''}</span>
                      {m.class !== 'otc' && <ClassTag cls={m.class} />}
                      {m.cold_chain && <Snowflake size={14} color="var(--blue)" aria-label="Fridge" />}
                    </div>
                    <div className="s">
                      {[m.form, m.brand, m.shelf_name].filter(Boolean).join(' · ')}
                      {m.nearest_expiry && <> · <span className={d != null && d <= (pharmacy?.expiry_warning_days ?? 90) ? 'c-orange b' : ''}>next expiry {fmtShort(m.nearest_expiry)}</span></>}
                    </div>
                  </div>
                  <StockTag status={m.stock_status} onHand={Number(m.on_hand)} unit={m.unit} />
                </button>
              )
            })}
          </div></div>
        )}
      </div>
      {scan && <CameraScan onClose={() => setScan(false)} onCode={(c) => { setScan(false); setTerm(c) }} />}
      {adding != null && <MedicineSheet barcode={adding} onClose={() => { setAdding(null); if (params.get('new') != null) setParams({}, { replace: true }) }} onSaved={(id) => nav(`/medicines/${id}`)} />}
    </div>
  )
}
