import { useEffect, useState } from 'react';

export default function PayPalButton({ onComplete }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const script = document.createElement('script');
    const clientId = import.meta.env.VITE_PAYPAL_CLIENT_ID || 'test';
    script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD`;
    script.async = true;
    script.onload = () => setReady(true);
    document.body.appendChild(script);
    return () => script.remove();
  }, []);

  return (
    <button type="button" disabled={!ready} className="w-full rounded bg-amber-400 px-4 py-2 font-semibold text-slate-900 disabled:opacity-60" onClick={onComplete}>
      {ready ? 'Pay with PayPal' : 'Loading PayPal…'}
    </button>
  );
}
