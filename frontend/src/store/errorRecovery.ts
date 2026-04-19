import { builderActions } from '@features/builder/store/builderSlice';
import { builderSessionActions } from '@features/builder/store/builderSessionSlice';
import { domainActions } from '@features/builder/store/domainSlice';
import { REMEMBER_KEYS, REMEMBER_PREFIX } from './persistence';
import { store } from './store';

function clearPersistedAppState() {
  for (const key of REMEMBER_KEYS) {
    window.localStorage.removeItem(`${REMEMBER_PREFIX}${key}`);
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
