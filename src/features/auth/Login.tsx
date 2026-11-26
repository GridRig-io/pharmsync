import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { KeyRound, ShieldCheck, Store } from 'lucide-react'
import { supabase, friendlyError, rpc } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { Clanker } from '../../components/Clanker'
import { Field, Note } from '../../components/ui'

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="login-wrap">
      <div className="login stack loose">
        <div className="row">
          <img src="/favicon.svg" alt="" width={44} height={44} style={{ borderRadius: 12 }} />
          <div><div className="h2">PharmSync</div><div className="small muted">Pharmacy stock, expiry and till</div></div>
        </div>
        {children}
        <div style={{ textAlign: 'center' }}><Clanker /></div>
      </div>
    </div>
  )
}

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [mode, setMode] = useState<'in' | 'forgot' | 'sent'>('in')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/reset` })
        if (error) throw error
        setMode('sent')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      }
    } catch (e2) { setErr(friendlyError(e2)) } finally { setBusy(false) }
  }

  return (
    <Shell>
      <form className="card stack loose" onSubmit={submit}>
        <h1 className="h2">{mode === 'in' ? 'Sign in' : 'Reset your password'}</h1>
        {mode === 'sent' ? <Note tone="green">Check your email for a link to set a new password.</Note> : (
          <>
            <Field label="Email" htmlFor="em"><input id="em" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            {mode === 'in' && (
              <Field label="Password" htmlFor="pw"><input id="pw" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            )}
            {err && <Note tone="red">{err}</Note>}
            <button className="btn next lg block" disabled={busy}>{busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Send reset link'}</button>
          </>
        )}
        <button type="button" className="link" onClick={() => { setErr(''); setMode(mode === 'in' ? 'forgot' : 'in') }}>
          {mode === 'in' ? 'Forgot password?' : 'Back to sign in'}
        </button>
      </form>
      <p className="small muted" style={{ textAlign: 'center' }}>Already use LabSync? The same email and password work here once your pharmacy admin adds you.</p>
    </Shell>
  )
}

export function ResetPassword() {
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [done, setDone] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('')
    if (pw.length < 8) return setErr('Use at least 8 characters.')
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) setErr(friendlyError(error)); else setDone(true)
  }
  return (
    <Shell>
      <form className="card stack loose" onSubmit={submit}>
        <h1 className="h2"><KeyRound size={20} /> New password</h1>
        {done ? <><Note tone="green">Password changed.</Note><a className="btn next lg block" href="/">Open PharmSync</a></> : (
          <>
            <Field label="New password" hint="At least 8 characters"><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            {err && <Note tone="red">{err}</Note>}
            <button className="btn next lg block">Save password</button>
          </>
        )}
      </form>
    </Shell>
  )
}

/** Signed in, but not on a pharmacy's staff list (or switched off). */
export function NoAccess({ inactive }: { inactive?: boolean }) {
  const { session, refresh } = useSession()
  const { data: canClaim } = useQuery({ queryKey: ['can-claim'], enabled: !inactive, queryFn: () => rpc<boolean>('ph_can_claim') })
  const claim = useMutation({ mutationFn: () => rpc('ph_claim_pharmacy'), onSuccess: () => refresh() })
  return (
    <Shell>
      <div className="card stack loose">
        {inactive ? (
          <>
            <h1 className="h2">Your account is switched off</h1>
            <p className="muted">Ask the superintendent pharmacist to switch it back on in Settings → Staff.</p>
          </>
        ) : canClaim ? (
          <>
            <span className="chip-ic ic-pine"><Store size={20} /></span>
            <h1 className="h2">Set up this pharmacy</h1>
            <p className="muted">Nobody runs this pharmacy in PharmSync yet. You'll become its <b>superintendent pharmacist (admin)</b>, then you can add your staff.</p>
            <Note tone="violet" icon={<ShieldCheck size={18} />}>Only do this if you are the person in charge. The first person to tap this becomes the admin.</Note>
            {claim.error && <Note tone="red">{(claim.error as Error).message}</Note>}
            <button className="btn next lg block" disabled={claim.isPending} onClick={() => claim.mutate()}>{claim.isPending ? 'Setting up…' : 'Make me the admin'}</button>
          </>
        ) : (
          <>
            <h1 className="h2">You're not on a pharmacy's staff yet</h1>
            <p className="muted">You're signed in as <b>{session?.user.email}</b>. Ask your pharmacy's admin to add this email in Settings → Staff, then come back.</p>
            <button className="btn soft block" onClick={() => refresh()}>Check again</button>
          </>
        )}
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </Shell>
  )
}
