import { resetAppStateWithDispatch } from './resetAppState';
import { store } from './store';

export function resetAppState() {
  resetAppStateWithDispatch(store.dispatch);
}

export function resetAppStateAndReload() {
  resetAppState();
  window.location.reload();
}
