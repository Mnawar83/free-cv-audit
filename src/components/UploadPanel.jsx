import { useRef, useState } from 'react';
import { initRun } from '../api/client';
import { useAppStore } from '../context/AppStore';

async function extractText(file) {
  if (file.type === 'application/pdf') {
    await import('pdfjs-dist');
    return `PDF uploaded: ${file.name}`;
  }
  if (file.type.includes('word') || file.name.endsWith('.docx')) {
    await import('mammoth');
    return `DOCX uploaded: ${file.name}`;
  }
  return file.text();
}

export default function UploadPanel({ onParsed, onError }) {
  const inputRef = useRef(null);
  const { dispatch } = useAppStore();
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file) => {
    try {
      if (!file) throw new Error('Please select a CV file before continuing.');
      const run = await initRun(file.name);
      dispatch({ type: 'SET_RUN', payload: run?.runId ?? null });
      const text = await extractText(file);
      onParsed(text);
    } catch (error) {
      onError(error.message);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:p-6" aria-labelledby="upload-title">
      <h2 id="upload-title" className="text-xl font-semibold">Upload your CV</h2>
      <p id="upload-description" className="mt-2 text-sm text-slate-300">Drag and drop your PDF or DOCX, or browse from your device.</p>
      <label
        htmlFor="cv-file"
        className={`mt-4 block cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition ${
          dragging ? 'border-blue-400 bg-blue-500/10' : 'border-slate-700'
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFile(event.dataTransfer.files?.[0]);
        }}
      >
        <span className="block font-medium">Drop your file here</span>
        <span className="mt-1 block text-sm text-slate-300">or click to browse</span>
      </label>
      <input
        id="cv-file"
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx"
        className="sr-only"
        aria-describedby="upload-description"
        aria-label="CV file upload"
        onChange={(event) => handleFile(event.target.files?.[0])}
      />
      <button type="button" className="mt-3 rounded bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700" onClick={() => inputRef.current?.click()}>
        Choose file
      </button>
    </section>
  );
}
