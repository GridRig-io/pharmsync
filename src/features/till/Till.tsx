import { useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, Search, Trash2, FileText, Repeat, AlertTriangle, Lock, ShoppingCart, Banknote, CreditCard, Landmark, Smartphone, Check } from 'lucide-react'
import { rpc } from '../../lib/supabase'
import { useStock } from '../../lib/data'
import { useCart, needsRx, type CartLine } from '../../lib/cart'
import { useToast } from '../../lib/toast'
import { ACTIVE_PROVIDER, METHOD_HINT } from '../../lib/payments'
import { fmtShort, medLabel, money, PAY_LABEL } from '../../lib/format'
import type { PayMethod, RxItem, StockRow } from '../../lib/types'
import { ClassTag, Empty, Field, Note, Stepper } from '../../components/ui'
import { CameraScan } from '../../components/CameraScan'
import { RxSheet } from '../prescriptions/RxSheet'
import { RxPicker } from '../prescriptions/RxPicker'
import { ReceiptSheet } from './Receipt'

const METHODS: { value: PayMethod; icon: typeof Banknote }[] = [
  { value: 'cash', icon: Banknote }, { value: 'card', icon: CreditCard }, { value: 'transfer', icon: Landmark }, { value: 'ussd', icon: Smartphone },
]

export default function Till() {
  const { data: stock } = useStock()
  const cart = useCart()
  const qc = useQueryClient(); const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [term, setTerm] = useState('')
  const [scan, setScan] = useState(false)
  const [method, setMethod] = useState<PayMethod>('cash')
  const [tendered, setTendered] = useState('')
  const [ref, setRef] = useState('')
  const [discount, setDiscount] = useState('')
  const [customer, setCustomer] = useState('')
  const [rxFor, setRxFor] = useState<CartLine | null>(null)
  const [pickFor, setPickFor] = useState<CartLine | null>(null)
  const [done, setDone] = useState<null | { id: string; change: number | null }>(null)

  const hits = useMemo(() => {
    const t = term.trim().toLowerCase(); if (t.length < 2) return []
    return (stock ?? []).filter((m) => m.barcode === term.trim() || [m.name, m.brand].some((x) => x?.toLowerCase().includes(t))).slice(0, 8)
  }, [stock, term])

  const addMed = (m: StockRow) => {
    if (Number(m.on_hand) <= 0) { toast(`${medLabel(m)} is out of stock`, { tone: 'error' }); return }
    const inCart = cart.lines.find((l) => l.medicine_id === m.id)?.quantity ?? 0
    if (inCart + 1 > Number(m.on_hand)) { toast(`Only ${m.on_hand} ${m.unit} on the shelf`, { tone: 'error' }); return }
    cart.add({ medicine_id: m.id, name: [m.name, m.strength].filter(Boolean).join(' '), unit: m.unit, class: m.class, price: Number(m.sell_price), available: Number(m.on_hand), lasa_note: m.lasa_note })
    setTerm(''); navigator.vibrate?.(30)
    setTimeout(() => input.current?.focus(), 0)
  }
  // A USB or Bluetooth scanner types the code and presses Enter
  const onEnter = () => {
    const exact = (stock ?? []).find((m) => m.barcode && m.barcode === term.trim())
    if (exact) return addMed(exact)
    if (hits.length === 1) return addMed(hits[0]!)
    if (hits.length === 0 && term.trim()) toast(`No medicine with “${term.trim()}”`, { tone: 'error' })
  }

  const subtotal = cart.lines.reduce((s, l) => s + l.price * l.quantity, 0)
  const disc = Math.min(Number(discount) || 0, subtotal)
  const total = subtotal - disc
  const cash = Number(tendered.replace(/,/g, '')) || 0
  const change = method === 'cash' ? cash - total : null
  const blocked = cart.lines.filter((l) => needsRx(l.class) && !l.rx)
  const overRx = cart.lines.filter((l) => l.rx && l.quantity > l.rx.remaining)
  const canPay = cart.lines.length > 0 && blocked.length === 0 && overRx.length === 0 && (method === 'cash' ? cash >= total : ref.trim().length > 0 || ACTIVE_PROVIDER.connected)

  const pay = useMutation({
    mutationFn: async () => {
      let reference = ref.trim() || null
      if (method !== 'cash' && ACTIVE_PROVIDER.charge) reference = (await ACTIVE_PROVIDER.charge(total, method)).reference
      return rpc<{ sale_id: string; number: number; total: number; change: number | null }>('ph_checkout', {
        p_lines: cart.lines.map((l) => ({ medicine_id: l.medicine_id, quantity: l.quantity, prescription_item_id: l.rx?.item_id ?? null })),
        p_method: method, p_ref: reference, p_tendered: method === 'cash' ? cash : null, p_customer: customer.trim() || null, p_discount: disc,
      })
    },
    onSuccess: (r) => {
      ;['stock', 'batches', 'sales', 'home', 'rx'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      cart.clear(); setTendered(''); setRef(''); setDiscount(''); setCustomer('')
      setDone({ id: r.sale_id, change: r.change })
    },
    onError: (e) => toast((e as Error).message, { tone: 'error' }),
  })

  const attachSaved = (line: CartLine, r: RxItem) => {
    cart.attachRx(line.medicine_id, { item_id: r.id, patient: r.patient_name, prescriber: r.prescriber_name, remaining: Number(r.remaining), valid_until: r.valid_until })
    setPickFor(null); toast(`Linked to ${r.patient_name}'s prescription`)
  }
  const quick = [total, Math.ceil(total / 500) * 500, Math.ceil(total / 1000) * 1000, Math.ceil(total / 5000) * 5000].filter((v, i, a) => v > 0 && a.indexOf(v) === i).slice(0, 4)

  return (
    <div className="page wide">
      <div className="till">
        <div className="stack">
          <div className="spread">
            <h1 className="h1">Sell</h1>
            <span className="device" title="Payment terminal"><i className={ACTIVE_PROVIDER.connected ? 'ok' : ''} />{ACTIVE_PROVIDER.connected ? ACTIVE_PROVIDER.label : 'POS: enter reference by hand'}</span>
          </div>
          <div className="row scan-field" style={{ position: 'relative' }}>
            <div className="input-ic grow">
              <Search size={20} />
              <input ref={input} className="input" autoFocus placeholder="Scan a barcode or type a name" value={term} onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter() } if (e.key === 'Escape') setTerm('') }} aria-label="Scan or search" />
            </div>
            <button className="icon-btn" style={{ width: 54, height: 54 }} aria-label="Scan with camera" onClick={() => setScan(true)}><Camera size={22} /></button>
            {hits.length > 0 && (
              <div className="results"><div className="list">
                {hits.map((m) => (
                  <button key={m.id} className="li" onClick={() => addMed(m)} disabled={Number(m.on_hand) <= 0}>
                    <div className="grow">
                      <div className="t">{medLabel(m)}</div>
                      <div className="s">{m.brand ?? ''} {Number(m.on_hand) > 0 ? `· ${m.on_hand} ${m.unit} left` : '· out of stock'}{m.shelf_name ? ` · ${m.shelf_name}` : ''}</div>
                    </div>
                    {m.class !== 'otc' && <ClassTag cls={m.class} />}
                    <span className="mono b">{money(m.sell_price)}</span>
                  </button>
                ))}
              </div></div>
            )}
          </div>

          {cart.lines.length === 0 ? (
            <div className="card"><Empty icon={<ShoppingCart size={28} />} title="Cart is empty" text="Scan a pack, or type the medicine's name and press Enter." /></div>
          ) : (
            <div className="card flush"><div className="list">
              {cart.lines.map((l) => {
                const rxOnly = needsRx(l.class)
                const max = l.rx ? Math.min(l.available, l.rx.remaining) : l.available
                return (
                  <div key={l.medicine_id} className="li" style={{ display: 'block', padding: 0, cursor: 'default' }}>
                    <div className={`cart-row ${rxOnly ? 'rx' : ''}`}>
                      <div className="grow">
                        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><span className="t">{l.name}</span>{rxOnly && <ClassTag cls={l.class} />}</div>
                        <div className="s">{money(l.price)} per {l.unit} · {l.available} on shelf</div>
                      </div>
                      <Stepper value={l.quantity} min={1} max={max} onChange={(n) => cart.setQty(l.medicine_id, n)} label={`${l.name} quantity`} />
                      <div className="mono b" style={{ minWidth: 84, textAlign: 'right' }}>{money(l.price * l.quantity)}</div>
                      <button className="icon-btn plain" aria-label={`Remove ${l.name}`} onClick={() => cart.remove(l.medicine_id)}><Trash2 size={18} /></button>
                    </div>
                    {l.lasa_note && <div style={{ padding: '0 14px 10px' }}><Note tone="amber" icon={<AlertTriangle size={16} />}>{l.lasa_note}</Note></div>}
                    {rxOnly && (l.rx ? (
                      <div className="rx-gate">
                        <span className="tag violet"><Check size={12} /> Prescription linked</span>
                        <span className="small grow">{l.rx.patient} · {l.rx.prescriber} · {l.rx.remaining} {l.unit} allowed · fill by {fmtShort(l.rx.valid_until)}</span>
                        <button className="link" onClick={() => cart.attachRx(l.medicine_id, undefined)}>Change</button>
                      </div>
                    ) : (
                      <div className="rx-gate">
                        <span className="small b c-violet grow">{l.class === 'controlled' ? <Lock size={14} style={{ verticalAlign: '-2px' }} /> : <FileText size={14} style={{ verticalAlign: '-2px' }} />} Needs a prescription before it can be sold</span>
                        <button className="btn sm violet" onClick={() => setPickFor(l)}><Repeat size={16} /> Saved one</button>
                        <button className="btn sm violet-solid" onClick={() => setRxFor(l)}>Record prescription</button>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div></div>
          )}
        </div>

        <aside className="pay card stack">
          <div className="spread"><span className="muted">Subtotal</span><span className="mono">{money(subtotal)}</span></div>
          <div className="grid2">
            <Field label="Discount (₦)"><input className="input mono" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
            <Field label="Customer (optional)"><input className="input" value={customer} onChange={(e) => setCustomer(e.target.value)} /></Field>
          </div>
          <div className="spread"><span className="h3">Total</span><span className="big">{money(total)}</span></div>
          <div className="pay-methods" role="radiogroup" aria-label="Payment method">
            {METHODS.map((m) => (
              <button key={m.value} type="button" role="radio" aria-checked={method === m.value} className={`pay-method ${method === m.value ? 'on' : ''}`} onClick={() => setMethod(m.value)}>
                <div className="t row" style={{ gap: 6 }}><m.icon size={16} /> {PAY_LABEL[m.value]}</div>
                <div className="s">{METHOD_HINT[m.value]}</div>
              </button>
            ))}
          </div>
          {method === 'cash' ? (
            <>
              <Field label="Cash given (₦)"><input className="input mono" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value.replace(/[^\d.,]/g, ''))} style={{ fontSize: '1.2rem' }} /></Field>
              {total > 0 && <div className="chips">{quick.map((v) => <button key={v} type="button" className="chip" onClick={() => setTendered(String(v))}>{money(v)}</button>)}</div>}
              {cash > 0 && <div className={`spread ${change! < 0 ? 'c-red' : 'c-green'}`}><span className="b">{change! < 0 ? 'Still to pay' : 'Change'}</span><span className="h2 mono">{money(Math.abs(change!))}</span></div>}
            </>
          ) : (
            <Field label="Reference" hint={method === 'card' ? 'From the POS slip, after it says APPROVED' : 'From the bank alert. Wait for the alert before handing over.'}>
              <input className="input mono" value={ref} onChange={(e) => setRef(e.target.value)} />
            </Field>
          )}
          {blocked.length > 0 && <Note tone="violet">{blocked.map((b) => b.name).join(', ')} {blocked.length === 1 ? 'needs' : 'need'} a prescription first.</Note>}
          {overRx.length > 0 && <Note tone="red">More than the prescription allows for {overRx.map((b) => b.name).join(', ')}.</Note>}
          <button className="btn next lg block" disabled={!canPay || pay.isPending} onClick={() => pay.mutate()}>{pay.isPending ? 'Saving…' : `Take payment ${money(total)}`}</button>
          {cart.lines.length > 0 && <button className="btn ghost sm" onClick={() => cart.clear()}>Clear cart</button>}
        </aside>
      </div>

      {scan && <CameraScan onClose={() => setScan(false)} onCode={(c) => {
        setScan(false)
        const m = (stock ?? []).find((s) => s.barcode === c)
        if (m) addMed(m); else { setTerm(c); toast(`No medicine with barcode ${c}`, { tone: 'error' }) }
      }} />}
      {pickFor && <RxPicker medicineId={pickFor.medicine_id} name={pickFor.name} onClose={() => setPickFor(null)} onPick={(r) => attachSaved(pickFor, r)} onNew={() => { setRxFor(pickFor); setPickFor(null) }} />}
      {rxFor && (
        <RxSheet onClose={() => setRxFor(null)}
          preset={cart.lines.filter((l) => needsRx(l.class) && !l.rx).map((l) => ({ medicine_id: l.medicine_id, label: l.name, qty: l.quantity }))}
          onSaved={(rx) => {
            for (const it of rx.items) {
              if (cart.lines.some((l) => l.medicine_id === it.medicine_id)) cart.attachRx(it.medicine_id, { item_id: it.id, patient: rx.patient, prescriber: rx.prescriber, remaining: rx.qty[it.medicine_id] ?? 0, valid_until: rx.valid_until })
            }
          }} />
      )}
      {done && <ReceiptSheet saleId={done.id} fresh change={done.change} onClose={() => { setDone(null); setTimeout(() => input.current?.focus(), 0) }} />}
    </div>
  )
}
