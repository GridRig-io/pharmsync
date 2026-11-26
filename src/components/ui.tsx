import { useEffect, useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X, Minus, Plus, Lock, FileText, ShoppingBag, ChevronRight } from 'lucide-react'
import { stubFor } from '../lib/format'
import type { MedClass } from '../lib/types'

/* ---------- headers ---------- */
export function PageHead({ kicker, title, sub, actions }: { kicker?: string; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {kicker && <div className="kicker">{kicker}</div>}
        <h1 className="h1">{title}</h1>
        {sub && <p className="muted small">{sub}</p>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </header>
  )
}
export function SecHead({ title, action, count }: { title: string; action?: ReactNode; count?: number }) {
  return (
    <div className="sec-head">
      <h2 className="h3">{title}{count != null && <span className="faint"> · {count}</span>}</h2>
      {action}
    </div>
  )
}

/* ---------- "?" plain-words help ---------- */
export function Help({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="help-chip" style={{ border: 0, cursor: 'pointer' }} aria-label="What does this mean?" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o) }}>?</button>
      {open && <span className="note violet small" style={{ display: 'flex', marginTop: 6, width: '100%' }}>{children}</span>}
    </>
  )
}
export function Note({ tone = 'plain', icon, children }: { tone?: 'violet' | 'amber' | 'red' | 'green' | 'plain'; icon?: ReactNode; children: ReactNode }) {
  return <div className={`note ${tone}`} role={tone === 'red' ? 'alert' : undefined}>{icon}<div>{children}</div></div>
}

/* ---------- tags ---------- */
export function Tag({ tone = 'grey', children }: { tone?: string; children: ReactNode }) {
  return <span className={`tag ${tone}`}>{children}</span>
}
export function ClassTag({ cls }: { cls: MedClass }) {
  if (cls === 'controlled') return <span className="tag violet"><Lock size={12} /> Controlled</span>
  if (cls === 'pom') return <span className="tag violet"><FileText size={12} /> Rx only</span>
  return <span className="tag green"><ShoppingBag size={12} /> OTC</span>
}
export function StockTag({ status, onHand, unit }: { status: 'out' | 'low' | 'ok'; onHand: number; unit: string }) {
  if (status === 'out') return <Tag tone="red">Out of stock</Tag>
  if (status === 'low') return <Tag tone="orange">Low · {onHand} {unit}</Tag>
  return <Tag tone="green">{onHand} {unit}</Tag>
}

/* ---------- shelf label card: the stub says how long is left ---------- */
export function LabelCard({ daysLeft, warnDays, quarantine, children, onClick, pick, aside }: {
  daysLeft: number | null; warnDays: number; quarantine?: boolean; children: ReactNode; onClick?: () => void; pick?: boolean; aside?: ReactNode
}) {
  const s = quarantine ? { cls: 'q' as const, big: '⏸', small: 'on hold' } : stubFor(daysLeft, warnDays)
  const inner = (
    <>
      <div className={`stub ${s.cls}`}><b>{s.big}</b>{s.small}</div>
      <div className="body">{children}</div>
      {aside && <div className="row" style={{ padding: '0 12px' }}>{aside}</div>}
      {onClick && !aside && <div className="row" style={{ padding: '0 10px' }}><ChevronRight className="chev" size={18} /></div>}
    </>
  )
  return onClick
    ? <button type="button" className={`label-card ${pick ? 'pick' : ''}`} onClick={onClick} style={{ cursor: 'pointer', padding: 0 }}>{inner}</button>
    : <div className={`label-card ${pick ? 'pick' : ''}`}>{inner}</div>
}

/* ---------- stock meter ---------- */
export function Meter({ value, reorder, max }: { value: number; reorder: number; max?: number | null }) {
  const top = Math.max(max ?? reorder * 3, value, 1)
  const cls = value <= 0 ? 'out' : value <= reorder ? 'low' : ''
  return (
    <div className={`meter ${cls}`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={top} aria-label={`${value} on hand, reorder at ${reorder}`}>
      <i style={{ width: `${Math.min(100, (value / top) * 100)}%` }} />
      {reorder > 0 && <span className="mark" style={{ left: `${(reorder / top) * 100}%` }} />}
    </div>
  )
}

/* ---------- empty / loading / error ---------- */
export function Empty({ icon, title, text, action }: { icon?: ReactNode; title?: string; text: string; action?: ReactNode }) {
  return <div className="empty">{icon}{title && <div className="h3" style={{ color: 'var(--ink)' }}>{title}</div>}<p>{text}</p>{action}</div>
}
export function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <div className="card stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="stack tight">
          <div className="skel" style={{ width: `${50 + ((i * 17) % 40)}%` }} />
          <div className="skel" style={{ width: `${25 + ((i * 11) % 30)}%`, height: 10 }} />
        </div>
      ))}
    </div>
  )
}
export function ErrorNote({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="note red" role="alert" style={{ alignItems: 'center' }}>
      <div className="grow"><b>Couldn't load this.</b> {(error as Error)?.message ?? 'Something went wrong.'}</div>
      {retry && <button className="btn sm" onClick={retry}>Try again</button>}
    </div>
  )
}

/* ---------- sheet: bottom sheet on phone, side drawer on bigger screens ---------- */
export function Sheet({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean
}) {
  const id = useId()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="grabber" />
        <div className="sheet-head">
          <h2 id={id}>{title}</h2>
          <button className="icon-btn plain" onClick={onClose} aria-label="Close"><X size={22} /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  )
}

/* ---------- form bits ---------- */
export function Field({ label, hint, error, children, htmlFor, help }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor?: string; help?: ReactNode }) {
  return (
    <div className="field">
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><label className="lbl" htmlFor={htmlFor}>{label}</label>{help && <Help>{help}</Help>}</div>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err">{error}</span>}
    </div>
  )
}
export function Stepper({ value, onChange, min = 1, max, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string }) {
  const clamp = (n: number) => Math.max(min, max != null ? Math.min(max, n) : n)
  return (
    <div className="stepper">
      <button type="button" aria-label={`Fewer ${label}`} onClick={() => onChange(clamp(value - 1))}><Minus size={18} /></button>
      <input aria-label={label} inputMode="numeric" value={Number.isFinite(value) ? value : ''}
        onChange={(e) => { const n = parseInt(e.target.value, 10); onChange(Number.isFinite(n) ? clamp(n) : min) }}
        onFocus={(e) => e.target.select()} />
      <button type="button" aria-label={`More ${label}`} onClick={() => onChange(clamp(value + 1))}><Plus size={18} /></button>
    </div>
  )
}
export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}
export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o.value} type="button" className={`chip ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)} aria-pressed={value === o.value}>{o.label}</button>
      ))}
    </div>
  )
}
/** Yes / No answer. null = not answered yet. */
export function YesNo({ value, onChange, label }: { value: boolean | null; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="yn" role="group" aria-label={label}>
      <button type="button" className={`yes ${value === true ? 'on' : ''}`} aria-pressed={value === true} onClick={() => onChange(true)}>Yes</button>
      <button type="button" className={`no ${value === false ? 'on' : ''}`} aria-pressed={value === false} onClick={() => onChange(false)}>No</button>
    </div>
  )
}
export function CheckRow({ title, sub, value, onChange, current, help }: { title: string; sub?: string; value: boolean | null; onChange: (v: boolean) => void; current?: boolean; help?: ReactNode }) {
  return (
    <div className={`check-row ${current ? 'current' : ''}`}>
      <div className="grow">
        <div className="row" style={{ gap: 6 }}><span className="t">{title}</span>{help && <Help>{help}</Help>}</div>
        {sub && <div className="s">{sub}</div>}
      </div>
      <YesNo value={value} onChange={onChange} label={title} />
    </div>
  )
}
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><i /></button>
}
export function Avatar({ name }: { name: string | null | undefined }) {
  const ini = (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '··'
  return <span className="chip-ic round ic-pine b small" aria-hidden>{ini}</span>
}
