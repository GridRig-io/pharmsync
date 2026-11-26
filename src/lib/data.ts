import { useQuery } from '@tanstack/react-query'
import { supabase, q } from './supabase'
import { addDays, todayISO } from './format'
import type { CheckKey, Shelf, Staff, StockRow, Supplier } from './types'
import { useSession } from './session'

export const useShelves = () => useQuery({
  queryKey: ['shelves'], staleTime: 5 * 60_000,
  queryFn: () => q<Shelf[]>(supabase.from('ph_shelves').select('*').order('name')),
})
export const useSuppliers = () => useQuery({
  queryKey: ['suppliers'], staleTime: 5 * 60_000,
  queryFn: () => q<Supplier[]>(supabase.from('ph_suppliers').select('*').order('name')),
})
export const useStaffList = () => useQuery({
  queryKey: ['staff'], staleTime: 60_000,
  queryFn: () => q<Staff[]>(supabase.from('ph_staff').select('*').order('full_name')),
})
export const useStock = () => useQuery({
  queryKey: ['stock'],
  queryFn: () => q<StockRow[]>(supabase.from('ph_stock').select('*').eq('archived', false).order('name')),
})

/** What needs someone today: drives the Home list and the red dot on the nav. */
export function useNeeds() {
  const { pharmacy } = useSession()
  return useQuery({
    queryKey: ['home', 'needs'], enabled: !!pharmacy, refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const today = todayISO()
      const [expired, soon, low, recalls, quarantine, checks] = await Promise.all([
        supabase.from('ph_batches').select('id', { count: 'exact', head: true }).eq('status', 'available').gt('quantity', 0).lt('expiry_date', today),
        supabase.from('ph_batches').select('id', { count: 'exact', head: true }).eq('status', 'available').gt('quantity', 0).gte('expiry_date', today).lte('expiry_date', addDays(today, 30)),
        supabase.from('ph_stock').select('id', { count: 'exact', head: true }).eq('archived', false).in('stock_status', ['low', 'out']).gt('reorder_level', 0),
        supabase.from('ph_recalls').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('ph_batches').select('id', { count: 'exact', head: true }).eq('status', 'quarantine').gt('quantity', 0),
        supabase.from('ph_daily_checks').select('check_key, done_at, done_by').eq('day', today),
      ])
      return {
        expired: expired.count ?? 0, soon: soon.count ?? 0, low: low.count ?? 0,
        recalls: recalls.count ?? 0, quarantine: quarantine.count ?? 0,
        checks: (checks.data ?? []) as { check_key: CheckKey; done_at: string; done_by: string | null }[],
      }
    },
  })
}
export const needsCount = (n?: { expired: number; recalls: number }) => (n ? n.expired + n.recalls : 0)

/** Mark one of today's opening checks as done. */
export async function markCheck(key: CheckKey, note?: string) {
  const { error } = await supabase.from('ph_daily_checks').upsert({ day: todayISO(), check_key: key, note: note ?? null }, { onConflict: 'pharmacy_id,day,check_key', ignoreDuplicates: true })
  if (error) throw error
}
