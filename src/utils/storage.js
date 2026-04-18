const STORAGE_KEY = 'free-cv-audit:v2';

export const initialState = {
  runId: null,
  user: null,
  paymentStatus: 'idle',
  entitlements: { audit: false, linkedin: false, coverLetter: false },
  auditResult: '',
};

export function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw);
    if (parsed?.schema !== 2) return initialState;
    return { ...initialState, ...parsed.data };
  } catch {
    return initialState;
  }
}

export function persistState(state) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ schema: 2, updatedAt: new Date().toISOString(), data: state }),
  );
}
