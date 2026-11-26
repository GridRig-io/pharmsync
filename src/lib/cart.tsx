import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { MedClass } from './types'

/** One line in the till cart. Prescription-only lines carry the prescription line they are dispensed against. */
export interface CartLine {
  medicine_id: string; name: string; unit: string; class: MedClass; price: number; quantity: number
  available: number; lasa_note: string | null
  rx?: { item_id: string; patient: string; prescriber: string; remaining: number; valid_until: string }
}
interface Ctx {
  lines: CartLine[]
  add: (l: Omit<CartLine, 'quantity'>, qty?: number) => void
  setQty: (id: string, qty: number) => void
  remove: (id: string) => void
  attachRx: (id: string, rx: CartLine['rx']) => void
  clear: () => void
}
const CartCtx = createContext<Ctx>(null as unknown as Ctx)
const KEY = 'ps-cart'

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => {
    try { return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as CartLine[] } catch { return [] }
  })
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(lines)) } catch { /* private mode */ } }, [lines])

  const value: Ctx = {
    lines,
    add: (l, qty = 1) => setLines((cur) => {
      const found = cur.find((x) => x.medicine_id === l.medicine_id)
      if (found) return cur.map((x) => x.medicine_id === l.medicine_id ? { ...x, quantity: x.quantity + qty, available: l.available } : x)
      return [...cur, { ...l, quantity: qty }]
    }),
    setQty: (id, qty) => setLines((cur) => cur.map((x) => x.medicine_id === id ? { ...x, quantity: Math.max(1, qty) } : x)),
    remove: (id) => setLines((cur) => cur.filter((x) => x.medicine_id !== id)),
    attachRx: (id, rx) => setLines((cur) => cur.map((x) => x.medicine_id === id
      ? { ...x, rx, quantity: rx ? Math.min(x.quantity, rx.remaining) || 1 : x.quantity } : x)),
    clear: () => setLines([]),
  }
  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>
}
export const useCart = () => useContext(CartCtx)
export const needsRx = (c: MedClass) => c === 'pom' || c === 'controlled'
