import { builderActions } from '@pages/Chat/builder/store/builderSlice';
import { builderSessionActions } from '@pages/Chat/builder/store/builderSessionSlice';
import { domainActions } from '@pages/Chat/builder/store/domainSlice';
import { REMEMBER_KEYS, REMEMBER_PREFIX } from './persistence';
import { store } from './store';

function clearPersistedSliceState(key: (typeof REMEMBER_KEYS)[number]) {
  window.localStorage.removeItem(`${REMEMBER_PREFIX}${key}`);
}

function clearPersistedAppState() {
  for (const key of REMEMBER_KEYS) {
    clearPersistedSliceState(key);
  }
}

export function resetAppState() {
  clearPersistedAppState();
  store.dispatch(domainActions.resetDomainState());
  store.dispatch(builderSessionActions.resetRuntimeSessionState());
  store.dispatch(builderActions.resetToEmpty());
}

export function resetAppStateAndReload() {
  resetAppState();
  window.location.reload();
}
