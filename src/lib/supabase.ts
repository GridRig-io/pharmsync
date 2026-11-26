import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string
if (!url || !key) console.error('PharmSync: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set')

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'pharmsync-auth' },
  realtime: { params: { eventsPerSecond: 5 } },
})

/** Turn a Supabase / Postgres error into a sentence someone at the counter can act on. */
export function friendlyError(e: unknown): string {
  const err = e as { message?: string; code?: string }
  const msg = err?.message ?? String(e)
  if (err?.code === '42501' || /row-level security|permission denied/i.test(msg)) return "You don't have permission to do this."
  if (err?.code === '23505' || /duplicate key/i.test(msg)) {
    if (/barcode/.test(msg)) return 'Another medicine already uses this barcode.'
    return 'That already exists.'
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'No connection. Check your internet and try again.'
  if (/Invalid login credentials/i.test(msg)) return 'Email or password is incorrect.'
  return msg.replace(/^.*?ERROR:\s*/, '')
}

/** Throw on error, return data otherwise. */
export async function q<T = unknown>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p
  if (error) throw error
  return data as T
}

/** Call an RPC and return its result, throwing a readable error. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(friendlyError(error))
  return data as T
}
