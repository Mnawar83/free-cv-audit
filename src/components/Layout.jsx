import { Link, NavLink } from 'react-router-dom';

export default function Layout({ children }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <a href="#main-content" className="sr-only sr-only-focusable">Skip to content</a>
      <header className="border-b border-slate-800/80 bg-slate-950/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4" aria-label="Primary">
          <Link to="/" className="text-lg font-semibold text-blue-300">Free CV Audit</Link>
          <div className="flex gap-4 text-sm">
            <NavLink to="/" className="hover:text-blue-300">Home</NavLink>
            <NavLink to="/results" className="hover:text-blue-300">Results</NavLink>
            <NavLink to="/account/sign-in" className="hover:text-blue-300">Account</NavLink>
          </div>
        </nav>
      </header>
      <main id="main-content" className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <footer className="border-t border-slate-800 px-4 py-6 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} Work Waves Career Services
      </footer>
    </div>
  );
}
