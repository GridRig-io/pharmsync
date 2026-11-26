import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Receipt } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { fmtTime, money, PAY_LABEL, startOfTodayISO } from '../../lib/format'
import type { PayMethod, Sale } from '../../lib/types'
import { Empty, ErrorNote, PageHead, SkeletonRows, Tag } from '../../components/ui'
import { ReceiptSheet } from './Receipt'

export default function Sales() {
  const [open, setOpen] = useState<string | null>(null)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['sales', 'today'],
    queryFn: () => q<Sale[]>(supabase.from('ph_sales').select('*').gte('created_at', startOfTodayISO()).order('created_at', { ascending: false })),
  })
  const paid = (data ?? []).filter((s) => s.status === 'paid')
  const by = (m: PayMethod) => paid.filter((s) => s.payment_method === m).reduce((t, s) => t + Number(s.total), 0)
  return (
    <div className="page stack">
      <PageHead title="Sales today" sub={`${paid.length} paid receipt${paid.length === 1 ? '' : 's'}`} />
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <div className="card"><div className="small muted">Total</div><div className="big">{money(paid.reduce((t, s) => t + Number(s.total), 0))}</div></div>
        {(['cash', 'card', 'transfer', 'ussd'] as PayMethod[]).map((m) => (
          <div key={m} className="card"><div className="small muted">{PAY_LABEL[m]}</div><div className="h2 mono">{money(by(m))}</div></div>
        ))}
      </div>
      {error ? <ErrorNote error={error} retry={refetch} /> : isLoading ? <SkeletonRows /> : (data ?? []).length === 0 ? (
        <div className="card"><Empty icon={<Receipt size={28} />} text="No sales yet today." /></div>
      ) : (
        <div className="card flush"><div className="list">
          {data!.map((s) => (
            <button key={s.id} className="li" onClick={() => setOpen(s.id)}>
              <div className="grow">
                <div className="t">#{s.number} · {money(s.total)}</div>
                <div className="s">{fmtTime(s.created_at)} · {PAY_LABEL[s.payment_method]}{s.payment_ref ? ` · ${s.payment_ref}` : ''}{s.customer_name ? ` · ${s.customer_name}` : ''}</div>
              </div>
              {s.status === 'void' ? <Tag tone="red">Void</Tag> : <Tag tone="green">Paid</Tag>}
            </button>
          ))}
        </div></div>
      )}
      {open && <ReceiptSheet saleId={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
