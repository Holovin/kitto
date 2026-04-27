import { builderActions } from '@pages/Chat/builder/store/builderSlice';
import { builderSessionActions } from '@pages/Chat/builder/store/builderSessionSlice';
import { domainActions } from '@pages/Chat/builder/store/domainSlice';
import { REMEMBER_KEYS, REMEMBER_PREFIX } from './persistence';
import type { AppDispatch } from './store';

function clearPersistedSliceState(key: (typeof REMEMBER_KEYS)[number]) {
  window.localStorage.removeItem(`${REMEMBER_PREFIX}${key}`);
}

export function clearPersistedAppState() {
  for (const key of REMEMBER_KEYS) {
    clearPersistedSliceState(key);
  }
}

export function resetAppStateWithDispatch(dispatch: AppDispatch) {
  clearPersistedAppState();
  dispatch(domainActions.resetDomainState());
  dispatch(builderSessionActions.resetRuntimeSessionState());
  dispatch(builderActions.resetToEmpty());
}
