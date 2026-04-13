import { builderActions } from '@features/builder/store/builderSlice';
import { builderSessionActions } from '@features/builder/store/builderSessionSlice';
import { domainActions } from '@features/builder/store/domainSlice';
import { store } from './store';

const REMEMBER_PREFIX = '@@remember-';
const REMEMBER_KEYS = ['builder', 'domain', 'rootState'] as const;

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
