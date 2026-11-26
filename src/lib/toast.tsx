import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

interface Toast { id: number; msg: string; tone?: 'error'; undo?: () => void | Promise<void> }
const ToastCtx = createContext<(msg: string, opts?: { tone?: 'error'; undo?: () => void | Promise<void> }) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const remove = (id: number) => setToasts((t) => t.filter((x) => x.id !== id))
  const show = useCallback((msg: string, opts?: { tone?: 'error'; undo?: () => void | Promise<void> }) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, msg, ...opts }])
    setTimeout(() => remove(id), opts?.undo ? 5000 : opts?.tone === 'error' ? 6000 : 3200)
    if (opts?.tone === 'error' && 'vibrate' in navigator) navigator.vibrate?.(80)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ''}`}>
            <span className="t-msg">{t.msg}</span>
            {t.undo && <button onClick={async () => { remove(t.id); await t.undo!() }}>Undo</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)
