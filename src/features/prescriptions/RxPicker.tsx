import { useQuery } from '@tanstack/react-query'
import { Repeat } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { daysUntil, fmtDate, todayISO } from '../../lib/format'
import type { RxItem } from '../../lib/types'
import { Empty, Sheet, SkeletonRows, Tag } from '../../components/ui'

/** Choose a prescription already on file that still has some left to fill (repeats, part-filled). */
export function RxPicker({ medicineId, name, onPick, onClose, onNew }: { medicineId: string; name: string; onPick: (r: RxItem) => void; onClose: () => void; onNew: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['rx', 'open', medicineId],
    queryFn: () => q<RxItem[]>(supabase.from('ph_rx_items').select('*').eq('medicine_id', medicineId).gt('remaining', 0).gte('valid_until', todayISO()).order('signed_at', { ascending: false }).limit(20)),
  })
  return (
    <Sheet open onClose={onClose} title={`Saved prescriptions · ${name}`} footer={<button className="btn next block" onClick={onNew}>Record a new prescription</button>}>
      {isLoading ? <SkeletonRows n={3} /> : (data ?? []).length === 0 ? <Empty text="No prescription on file with any left to fill. Record the new one." /> : (
        <div className="card flush"><div className="list">
          {data!.map((r) => {
            const left = daysUntil(r.valid_until) ?? 0
            return (
              <button key={r.id} className="li" onClick={() => onPick(r)}>
                <div className="grow">
                  <div className="t">{r.patient_name}</div>
                  <div className="s">{r.prescriber_name} · written {fmtDate(r.date_written)}</div>
                  <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    <Tag tone="violet">{r.remaining} of {r.qty_prescribed} {r.unit} left</Tag>
                    <Tag tone={left <= 2 ? 'orange' : 'green'}>fill by {fmtDate(r.valid_until, { day: 'numeric', month: 'short' })}</Tag>
                    {r.is_repeat && <Tag tone="blue"><Repeat size={12} /> Repeat</Tag>}
                  </div>
                </div>
              </button>
            )
          })}
        </div></div>
      )}
    </Sheet>
  )
}
