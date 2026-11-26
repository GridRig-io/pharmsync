import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Printer, Ban } from 'lucide-react'
import { supabase, q, rpc } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useStaffList } from '../../lib/data'
import { useToast } from '../../lib/toast'
import { fmtDate, fmtTime, money, PAY_LABEL } from '../../lib/format'
import type { Sale } from '../../lib/types'
import { Field, Note, Sheet, SkeletonRows, Tag } from '../../components/ui'

interface Line { medicine_id: string; quantity: number; unit_price: number; line_total: number; prescription_item_id: string | null; ph_medicines: { name: string; strength: string | null; unit: string } | null }

function useSaleDetail(id: string) {
  return useQuery({
    queryKey: ['sales', id],
    queryFn: async () => {
      const [sale, items] = await Promise.all([
        q<Sale>(supabase.from('ph_sales').select('*').eq('id', id).single()),
        q<Line[]>(supabase.from('ph_sale_items').select('medicine_id,quantity,unit_price,line_total,prescription_item_id,ph_medicines(name,strength,unit)').eq('sale_id', id)),
      ])
      // FEFO can split one line across batches: put them back together for the receipt
      const map = new Map<string, Line>()
      for (const l of items) {
        const cur = map.get(l.medicine_id)
        if (cur) { cur.quantity += Number(l.quantity); cur.line_total += Number(l.line_total) } else map.set(l.medicine_id, { ...l, quantity: Number(l.quantity), line_total: Number(l.line_total) })
      }
      return { sale, lines: [...map.values()] }
    },
  })
}

function Paper({ sale, lines, cashier }: { sale: Sale; lines: Line[]; cashier: string }) {
  const { pharmacy } = useSession()
  return (
    <div className="receipt">
      <div className="c"><b style={{ fontSize: 14 }}>{pharmacy?.name}</b></div>
      {pharmacy?.address && <div className="c">{pharmacy.address}</div>}
      {pharmacy?.phone && <div className="c">Tel {pharmacy.phone}</div>}
      {pharmacy?.pcn_premises_no && <div className="c">PCN premises {pharmacy.pcn_premises_no}</div>}
      <hr />
      <div>Receipt #{sale.number}{sale.status === 'void' && ' · VOID'}</div>
      <div>{fmtDate(sale.created_at)} {fmtTime(sale.created_at)} · {cashier}</div>
      {sale.customer_name && <div>Customer: {sale.customer_name}</div>}
      <hr />
      <table><tbody>
        {lines.map((l) => (
          <tr key={l.medicine_id}>
            <td>{l.ph_medicines?.name}{l.ph_medicines?.strength ? ` ${l.ph_medicines.strength}` : ''}{l.prescription_item_id ? ' (Rx)' : ''}<br />{l.quantity} × {money(l.unit_price)}</td>
            <td className="r">{money(l.line_total)}</td>
          </tr>
        ))}
      </tbody></table>
      <hr />
      <table><tbody>
        {Number(sale.discount) > 0 && <><tr><td>Subtotal</td><td className="r">{money(sale.subtotal)}</td></tr><tr><td>Discount</td><td className="r">−{money(sale.discount)}</td></tr></>}
        <tr><td><b>TOTAL</b></td><td className="r"><b>{money(sale.total)}</b></td></tr>
        <tr><td>{PAY_LABEL[sale.payment_method]}</td><td className="r">{sale.payment_method === 'cash' ? money(sale.amount_tendered) : sale.payment_ref ?? ''}</td></tr>
        {sale.payment_method === 'cash' && <tr><td>Change</td><td className="r">{money(sale.change_due)}</td></tr>}
      </tbody></table>
      <hr />
      {pharmacy?.receipt_footer && <div className="c">{pharmacy.receipt_footer}</div>}
      <div className="c" style={{ marginTop: 6, fontSize: 10 }}>PharmSync · Made by Clanker.</div>
    </div>
  )
}

export function ReceiptSheet({ saleId, onClose, fresh, change }: { saleId: string; onClose: () => void; fresh?: boolean; change?: number | null }) {
  const { can } = useSession()
  const { data } = useSaleDetail(saleId)
  const { data: team } = useStaffList()
  const qc = useQueryClient(); const toast = useToast()
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const voidSale = useMutation({
    mutationFn: () => rpc('ph_void_sale', { p_sale: saleId, p_reason: reason.trim() }),
    onSuccess: () => { ['sales', 'stock', 'batches', 'home', 'rx'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast('Sale voided. Stock is back on the shelf.'); onClose() },
    onError: (e) => toast((e as Error).message, { tone: 'error' }),
  })
  const cashier = team?.find((s) => s.id === data?.sale.cashier_id)?.full_name ?? ''

  return (
    <Sheet open onClose={onClose} title={data ? `Receipt #${data.sale.number}` : 'Receipt'}
      footer={<>
        {fresh && <button className="btn soft" onClick={onClose}>New sale</button>}
        <button className="btn next grow" disabled={!data} onClick={() => window.print()}><Printer size={18} /> Print receipt</button>
      </>}>
      {!data ? <SkeletonRows n={4} /> : (
        <div className="stack loose">
          {fresh && change != null && change > 0 && <div className="card tint spread"><span className="b">Give change</span><span className="big">{money(change)}</span></div>}
          {data.sale.status === 'void' && <Note tone="red">Voided: {data.sale.void_reason}</Note>}
          <div className="card" style={{ padding: 8, overflowX: 'auto' }}><Paper sale={data.sale} lines={data.lines} cashier={cashier} /></div>
          {!fresh && data.sale.status === 'paid' && can('sale.void') && (
            voiding ? (
              <div className="stack">
                <Field label="Why are you voiding it?" hint="All stock goes back to the same batches, and Rx quantities are restored"><textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                <div className="row"><button className="btn soft" onClick={() => setVoiding(false)}>Back</button><button className="btn danger grow" disabled={!reason.trim() || voidSale.isPending} onClick={() => voidSale.mutate()}>Void sale</button></div>
              </div>
            ) : <button className="btn danger block" onClick={() => setVoiding(true)}><Ban size={18} /> Void this sale</button>
          )}
          {data.sale.status === 'paid' && <div><Tag tone="green">Paid · {PAY_LABEL[data.sale.payment_method]}</Tag></div>}
        </div>
      )}
      {data && createPortal(<div className="print-area" aria-hidden><Paper sale={data.sale} lines={data.lines} cashier={cashier} /></div>, document.body)}
    </Sheet>
  )
}
