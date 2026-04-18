import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { initialState, loadPersistedState, persistState } from '../utils/storage';

const AppStore = createContext(null);

function reducer(state, action) {
  switch (action.type) {
    case 'SET_RUN':
      return { ...state, runId: action.payload };
    case 'SET_USER':
      return { ...state, user: action.payload };
    case 'SET_PAYMENT_STATUS':
      return { ...state, paymentStatus: action.payload };
    case 'SET_ENTITLEMENTS':
      return { ...state, entitlements: { ...state.entitlements, ...action.payload } };
    case 'SET_AUDIT':
      return { ...state, auditResult: action.payload };
    default:
      return state;
  }
}

export function AppStoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState, () =>
    typeof window === 'undefined' ? initialState : loadPersistedState(),
  );

  useEffect(() => {
    persistState(state);
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <AppStore.Provider value={value}>{children}</AppStore.Provider>;
}

export function useAppStore() {
  const ctx = useContext(AppStore);
  if (!ctx) throw new Error('useAppStore must be used inside AppStoreProvider');
  return ctx;
}
