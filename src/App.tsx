import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionProvider, useSession } from './lib/session'
import { ToastProvider } from './lib/toast'
import { CartProvider } from './lib/cart'
import { Layout, More } from './components/Layout'
import { Login, NoAccess, ResetPassword } from './features/auth/Login'
import { SkeletonRows } from './components/ui'
import { Home } from './features/home/Home'

const Till = lazy(() => import('./features/till/Till'))
const Sales = lazy(() => import('./features/till/Sales'))
const Medicines = lazy(() => import('./features/medicines/Medicines'))
const MedicineDetail = lazy(() => import('./features/medicines/MedicineDetail'))
const Receive = lazy(() => import('./features/receive/Receive'))
const Expiry = lazy(() => import('./features/expiry/Expiry'))
const Prescriptions = lazy(() => import('./features/prescriptions/Prescriptions'))
const Controlled = lazy(() => import('./features/controlled/Controlled'))
const Recalls = lazy(() => import('./features/recalls/Recalls'))
const Settings = lazy(() => import('./features/settings/Settings'))

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } } })
const L = ({ children }: { children: ReactNode }) => <Suspense fallback={<div className="page"><SkeletonRows /></div>}>{children}</Suspense>

function Gate() {
  const { session, ready, staff, staffLoaded } = useSession()
  if (location.pathname === '/reset') return <ResetPassword />
  if (!ready) return null
  if (!session) return <Login />
  if (!staffLoaded) return <div className="page"><SkeletonRows n={6} /></div>
  if (!staff) return <NoAccess />
  if (!staff.is_active) return <NoAccess inactive />
  return (
    <CartProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="sell" element={<L><Till /></L>} />
          <Route path="sales" element={<L><Sales /></L>} />
          <Route path="medicines" element={<L><Medicines /></L>} />
          <Route path="medicines/:id" element={<L><MedicineDetail /></L>} />
          <Route path="receive" element={<L><Receive /></L>} />
          <Route path="expiry" element={<L><Expiry /></L>} />
          <Route path="prescriptions" element={<L><Prescriptions /></L>} />
          <Route path="controlled" element={<L><Controlled /></L>} />
          <Route path="recalls" element={<L><Recalls /></L>} />
          <Route path="settings" element={<L><Settings /></L>} />
          <Route path="more" element={<More />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </CartProvider>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <BrowserRouter>
          <SessionProvider><Gate /></SessionProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}
