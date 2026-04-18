import { NavLink, Route, Routes } from 'react-router-dom';

function SignIn() {
  return (
    <form className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
      <fieldset>
        <legend className="mb-2 font-semibold">Sign in</legend>
        <label htmlFor="email" className="mb-1 block text-sm">Email</label>
        <input id="email" type="email" className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2" required aria-label="Account email" />
      </fieldset>
      <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm">Send verification code</button>
    </form>
  );
}

function Verify() {
  return (
    <form className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
      <fieldset>
        <legend className="mb-2 font-semibold">Verify code</legend>
        <label htmlFor="code" className="mb-1 block text-sm">6-digit code</label>
        <input id="code" inputMode="numeric" className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2" required />
      </fieldset>
      <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm">Verify</button>
    </form>
  );
}

function Subscriptions() {
  return <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">Manage subscription plans, billing portal, and cancellations.</section>;
}

function Workspace() {
  return <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">Invite collaborators and manage workspace access.</section>;
}

function Dashboard() {
  return <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">View run history, entitlements, and audit downloads.</section>;
}

export default function Account() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Account</h1>
      <nav className="flex flex-wrap gap-2" aria-label="Account sections">
        <NavLink className="rounded border border-slate-700 px-3 py-2 text-sm" to="sign-in">Sign in</NavLink>
        <NavLink className="rounded border border-slate-700 px-3 py-2 text-sm" to="verify">Verification</NavLink>
        <NavLink className="rounded border border-slate-700 px-3 py-2 text-sm" to="subscriptions">Subscriptions</NavLink>
        <NavLink className="rounded border border-slate-700 px-3 py-2 text-sm" to="workspace">Workspace</NavLink>
        <NavLink className="rounded border border-slate-700 px-3 py-2 text-sm" to="dashboard">Dashboard</NavLink>
      </nav>
      <Routes>
        <Route path="sign-in" element={<SignIn />} />
        <Route path="verify" element={<Verify />} />
        <Route path="subscriptions" element={<Subscriptions />} />
        <Route path="workspace" element={<Workspace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="*" element={<SignIn />} />
      </Routes>
    </section>
  );
}
