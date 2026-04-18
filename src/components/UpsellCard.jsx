import { useState } from 'react';

export default function UpsellCard({ title, description, price, features, onPurchase }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="text-sm text-slate-300">{description}</p>
        </div>
        <button type="button" onClick={() => setExpanded((v) => !v)} className="rounded border border-slate-700 px-3 py-1 text-xs" aria-expanded={expanded}>
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      </header>
      <p className="mt-3 text-xl font-bold text-blue-300">${price}</p>
      {expanded ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-300">
          {features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="mt-4 w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500" onClick={onPurchase}>
        Purchase {title}
      </button>
    </article>
  );
}
