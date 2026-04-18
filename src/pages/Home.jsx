import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UploadPanel from '../components/UploadPanel';
import Toast from '../components/Toast';
import { useAppStore } from '../context/AppStore';

export default function Home() {
  const navigate = useNavigate();
  const { dispatch } = useAppStore();
  const [toast, setToast] = useState({ type: 'info', message: '' });

  const handleParsed = (text) => {
    dispatch({ type: 'SET_AUDIT', payload: text });
    setToast({ type: 'success', message: 'CV uploaded. Continue to generate your audit.' });
    navigate('/results');
  };

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Smarter CV feedback in minutes</h1>
        <p className="max-w-2xl text-slate-300">Upload your CV, generate your audit, then unlock your revised CV download with PayPal or Whish Pay.</p>
      </header>
      <Toast type={toast.type} message={toast.message} />
      <div className="grid gap-4">
        <UploadPanel onParsed={handleParsed} onError={(message) => setToast({ type: 'error', message })} />
      </div>
    </section>
  );
}
