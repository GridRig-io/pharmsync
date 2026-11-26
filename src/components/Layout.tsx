import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Home, Pill, ScanLine, CalendarClock, Menu, PackagePlus, FileText, Lock, Siren, Receipt, Settings, LogOut, Thermometer } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
import { useNeeds } from '../lib/data'
import { ROLE_LABEL } from '../lib/format'
import { Clanker } from './Clanker'
import { Avatar } from './ui'
import { TempSheet } from './TempSheet'

const IDLE_MINUTES = 30

export function Layout() {
  const { staff, pharmacy, can } = useSession()
  const { data: needs } = useNeeds()
  const loc = useLocation()
  const nav = useNavigate()
  const [temp, setTemp] = useState(false)

  // Shared counter devices: sign out after a stretch with nobody touching it
  useEffect(() => {
    let t = 0
    const reset = () => { clearTimeout(t); t = window.setTimeout(() => supabase.auth.signOut(), IDLE_MINUTES * 60_000) }
    const evs = ['pointerdown', 'keydown', 'scroll'] as const
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => { clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, reset)) }
  }, [])
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])

  const expiryDot = (needs?.expired ?? 0) > 0
  const recallCount = needs?.recalls ?? 0
  const links = [
    { to: '/', label: 'Home', icon: Home, end: true },
    { to: '/medicines', label: 'Medicines', icon: Pill },
    { to: '/receive', label: 'Receive delivery', icon: PackagePlus, show: can('stock.write') },
    { to: '/expiry', label: 'Expiry & quarantine', icon: CalendarClock, count: needs?.expired },
    { to: '/prescriptions', label: 'Prescriptions', icon: FileText },
    { to: '/controlled', label: 'Controlled register', icon: Lock, show: can('controlled') },
    { to: '/recalls', label: 'Recalls', icon: Siren, count: recallCount },
    { to: '/sales', label: 'Sales today', icon: Receipt },
    { to: '/settings', label: 'Settings', icon: Settings },
  ].filter((l) => l.show !== false)

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="side-brand">
          <div className="name">PharmSync</div>
          <div className="small muted ellipsis">{pharmacy?.name}</div>
        </div>
        <NavLink to="/sell" className="btn next lg side-sell"><ScanLine size={20} /> Sell</NavLink>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
            <l.icon size={20} /> {l.label}
            {!!l.count && <span className="count">{l.count}</span>}
          </NavLink>
        ))}
        <button className="side-link" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => setTemp(true)}><Thermometer size={20} /> Log temperature</button>
        <div className="side-foot stack">
          <div className="row">
            <Avatar name={staff?.full_name} />
            <div className="grow">
              <div className="small b ellipsis">{staff?.full_name}</div>
              <div className="xs muted ellipsis">{staff ? ROLE_LABEL[staff.role] : ''}</div>
            </div>
            <button className="icon-btn plain" aria-label="Sign out" title="Sign out" onClick={() => supabase.auth.signOut()}><LogOut size={18} /></button>
          </div>
          <Clanker />
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="brand ellipsis">PharmSync<small className="ellipsis">{pharmacy?.name}</small></div>
          <button className="icon-btn" aria-label="Log a temperature" onClick={() => setTemp(true)}><Thermometer size={20} /></button>
          <button className="icon-btn only-mobile" aria-label="Recalls" onClick={() => nav('/recalls')}><Siren size={20} />{recallCount > 0 && <span className="badge" />}</button>
        </div>
        <Outlet />
      </div>

      <nav className="tabbar" aria-label="Main">
        <NavLink to="/" end className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}><Home size={24} />Home</NavLink>
        <NavLink to="/medicines" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}><Pill size={24} />Medicines</NavLink>
        <NavLink to="/sell" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}><span className="sell"><ScanLine size={24} /></span>Sell</NavLink>
        <NavLink to="/expiry" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}><CalendarClock size={24} />Expiry{expiryDot && <span className="dot" />}</NavLink>
        <NavLink to="/more" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}><Menu size={24} />More</NavLink>
      </nav>
      {temp && <TempSheet onClose={() => setTemp(false)} />}
    </div>
  )
}

/** Phone "More" page: the rest of the app, one tap away. */
export function More() {
  const { staff, can } = useSession()
  const { data: needs } = useNeeds()
  const items = [
    { to: '/receive', label: 'Receive a delivery', sub: 'Check and shelve new stock', icon: PackagePlus, tone: 'pine', show: can('stock.write') },
    { to: '/prescriptions', label: 'Prescriptions', sub: 'Rx-only list and filled today', icon: FileText, tone: 'violet' },
    { to: '/controlled', label: 'Controlled register', sub: 'Balances and daily count', icon: Lock, tone: 'violet', show: can('controlled') },
    { to: '/recalls', label: 'Recalls', sub: needs?.recalls ? `${needs.recalls} open` : 'None open', icon: Siren, tone: 'red' },
    { to: '/sales', label: 'Sales today', sub: 'Receipts, reprint, void', icon: Receipt, tone: 'blue' },
    { to: '/settings', label: 'Settings', sub: 'Rules, staff, shelves, my PIN', icon: Settings, tone: 'pine' },
  ].filter((i) => i.show !== false)
  return (
    <div className="page stack loose">
      <div className="card flush">
        <div className="list">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} className="li">
              <span className={`chip-ic ic-${i.tone}`}><i.icon size={20} /></span>
              <div className="grow"><div className="t">{i.label}</div><div className="s">{i.sub}</div></div>
            </NavLink>
          ))}
        </div>
      </div>
      <div className="card row">
        <Avatar name={staff?.full_name} />
        <div className="grow"><div className="b">{staff?.full_name}</div><div className="small muted">{staff ? ROLE_LABEL[staff.role] : ''}</div></div>
        <button className="btn soft sm" onClick={() => supabase.auth.signOut()}><LogOut size={16} /> Sign out</button>
      </div>
      <div style={{ textAlign: 'center' }}><Clanker /></div>
    </div>
  )
}
