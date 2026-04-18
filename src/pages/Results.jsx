import { lazy, Suspense, useMemo, useState } from 'react';
import { useAppStore } from '../context/AppStore';
import { generateAudit } from '../api/client';
import Skeleton from '../components/Skeleton';
import Modal from '../components/Modal';
import Toast from '../components/Toast';

const PayPalButton = lazy(() => import('../components/payment/PayPalButton'));
const WhishButton = lazy(() => import('../components/payment/WhishButton'));

export default function Results() {
  const { state, dispatch } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [toast, setToast] = useState({ type: 'info', message: '' });

  const hasAudit = useMemo(() => Boolean(state.auditResult?.trim()), [state.auditResult]);

  const runAudit = async () => {
    try {
      setLoading(true);
      const result = await generateAudit(state.runId, state.auditResult);
      dispatch({ type: 'SET_AUDIT', payload: result?.report || state.auditResult });
      setToast({ type: 'success', message: 'Audit generated successfully.' });
    } catch (error) {
      setToast({ type: 'error', message: `Audit failed: ${error.message}` });
    } finally {
      setLoading(false);
    }
  };

  const completePayment = () => {
    dispatch({ type: 'SET_PAYMENT_STATUS', payload: 'paid' });
    dispatch({ type: 'SET_ENTITLEMENTS', payload: { audit: true } });
    setShowPaymentModal(false);
    setToast({ type: 'success', message: 'Payment confirmed. Downloads are now available.' });
  };

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Audit results</h1>
      <Toast type={toast.type} message={toast.message} />
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4" aria-labelledby="audit-output-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="audit-output-title" className="text-lg font-semibold">Your CV audit</h2>
          <div className="flex gap-2">
            <button type="button" className="rounded bg-blue-600 px-4 py-2 text-sm" onClick={runAudit} disabled={!hasAudit || loading}>
              {loading ? 'Generating…' : 'Generate audit'}
            </button>
            <button type="button" className="rounded border border-slate-700 px-4 py-2 text-sm" onClick={() => setShowPaymentModal(true)}>
              Unlock downloads
            </button>
          </div>
        </div>
        {loading ? <Skeleton lines={8} /> : <p className="whitespace-pre-wrap text-sm text-slate-300">{state.auditResult || 'Upload a CV to get started.'}</p>}
      </section>

      <Modal
        open={showPaymentModal}
        title="Choose payment provider"
        description="Payments are loaded only when requested to keep initial load fast."
        onClose={() => setShowPaymentModal(false)}
      >
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold">Secure checkout</legend>
          <Suspense fallback={<Skeleton lines={2} />}>
            <PayPalButton onComplete={completePayment} />
            <div className="h-2" />
            <WhishButton onComplete={completePayment} />
          </Suspense>
        </fieldset>
      </Modal>
    </section>
  );
}
