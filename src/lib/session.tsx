import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, q } from './supabase'
import { setTimezone } from './format'
import type { Pharmacy, Role, Staff } from './types'

export type Perm = 'stock.write' | 'rx.sign' | 'batch.decide' | 'sale.void' | 'controlled' | 'recall' | 'admin'
const PERMS: Record<Perm, Role[]> = {
  'stock.write': ['admin', 'pharmacist', 'inventory_officer'],
  'rx.sign': ['admin', 'pharmacist'],
  'batch.decide': ['admin', 'pharmacist'],
  'sale.void': ['admin', 'pharmacist'],
  controlled: ['admin', 'pharmacist'],
  recall: ['admin', 'pharmacist'],
  admin: ['admin'],
}

interface Ctx {
  session: Session | null; ready: boolean; staffLoaded: boolean
  staff: Staff | null; pharmacy: Pharmacy | null
  can: (p: Perm) => boolean; refresh: () => void
}
const SessionCtx = createContext<Ctx>({ session: null, ready: false, staffLoaded: false, staff: null, pharmacy: null, can: () => false, refresh: () => {} })

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const qc = useQueryClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((evt, s) => {
      setSession(s)
      if (evt === 'SIGNED_OUT') qc.clear()
    })
    return () => sub.subscription.unsubscribe()
  }, [qc])

  const uid = session?.user.id
  const staffQ = useQuery({
    queryKey: ['me', uid], enabled: !!uid,
    queryFn: () => q<Staff | null>(supabase.from('ph_staff').select('*').eq('id', uid!).maybeSingle()),
  })
  const staff = staffQ.data ?? null
  const { data: pharmacy } = useQuery({
    queryKey: ['pharmacy', staff?.pharmacy_id], enabled: !!staff?.pharmacy_id && staff.is_active,
    queryFn: () => q<Pharmacy>(supabase.from('ph_pharmacies').select('*').eq('id', staff!.pharmacy_id).single()),
  })
  useEffect(() => { if (pharmacy?.timezone) setTimezone(pharmacy.timezone) }, [pharmacy?.timezone])

  // Live updates: another till sells, a delivery lands, a recall comes in
  useEffect(() => {
    if (!uid || !staff?.pharmacy_id) return
    const map: Record<string, string[][]> = {
      ph_batches: [['stock'], ['batches'], ['home']],
      ph_sales: [['sales'], ['home']],
      ph_recalls: [['recalls'], ['home']],
    }
    const ch = supabase.channel('pharmsync-live')
    for (const table of Object.keys(map)) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `pharmacy_id=eq.${staff.pharmacy_id}` },
        () => map[table]!.forEach((key) => qc.invalidateQueries({ queryKey: key })))
    }
    ch.subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [uid, staff?.pharmacy_id, qc])

  const value = useMemo<Ctx>(() => {
    const role = staff?.is_active ? staff.role : null
    return {
      session, ready, staffLoaded: !uid || staffQ.isFetched, staff, pharmacy: pharmacy ?? null,
      can: (p) => !!role && PERMS[p].includes(role),
      refresh: () => { qc.invalidateQueries({ queryKey: ['me'] }) },
    }
  }, [session, ready, uid, staffQ.isFetched, staff, pharmacy, qc])

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}
export const useSession = () => useContext(SessionCtx)
