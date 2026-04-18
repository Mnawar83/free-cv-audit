import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UploadPanel from '../components/UploadPanel';
import Toast from '../components/Toast';
import UpsellCard from '../components/UpsellCard';
import { useAppStore } from '../context/AppStore';

export default function Home() {
  const navigate = useNavigate();
  const { dispatch } = useAppStore();
  const [toast, setToast] = useState({ type: 'info', message: '' });
  const [showMobileUpsells, setShowMobileUpsells] = useState(false);

  const handleParsed = (text) => {
    dispatch({ type: 'SET_AUDIT', payload: text });
    setToast({ type: 'success', message: 'CV uploaded. Start your audit when ready.' });
    navigate('/results');
  };

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Smarter CV feedback in minutes</h1>
        <p className="max-w-2xl text-slate-300">Get an AI-powered CV review, purchase premium reports, and unlock LinkedIn and cover-letter add-ons.</p>
      </header>
      <Toast type={toast.type} message={toast.message} />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <UploadPanel onParsed={handleParsed} onError={(message) => setToast({ type: 'error', message })} />
        <aside className="hidden space-y-3 lg:block" aria-label="Upsell options">
          <UpsellCard title="LinkedIn Optimisation" description="Headline, summary and keyword upgrades" price="19" features={['ATS keyword tuning', 'Profile rewrite', 'Delivery in PDF and DOCX']} onPurchase={() => navigate('/results')} />
          <UpsellCard title="Cover Letter Pack" description="Targeted cover letter from your CV and job ad" price="15" features={['Job-tailored narrative', 'Recruiter-friendly format', 'Instant download']} onPurchase={() => navigate('/results')} />
        </aside>
      </div>

      <button type="button" className="rounded border border-slate-700 px-4 py-2 lg:hidden" onClick={() => setShowMobileUpsells((v) => !v)} aria-expanded={showMobileUpsells}>
        {showMobileUpsells ? 'Hide upgrades' : 'View upgrades'}
      </button>
      {showMobileUpsells ? (
        <div className="grid gap-3 lg:hidden">
          <UpsellCard title="LinkedIn Optimisation" description="Headline, summary and keyword upgrades" price="19" features={['ATS keyword tuning', 'Profile rewrite']} onPurchase={() => navigate('/results')} />
          <UpsellCard title="Cover Letter Pack" description="Targeted cover letter from your CV and job ad" price="15" features={['Job-tailored narrative', 'Recruiter-friendly format']} onPurchase={() => navigate('/results')} />
        </div>
      ) : null}
    </section>
  );
}
