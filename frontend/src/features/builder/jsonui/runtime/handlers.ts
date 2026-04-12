import { reduxStateStore } from '@json-render/redux';
import type { SetState } from '@json-render/react';
import { store, type RootState } from '@store/store';
import { replaceRuntimeState } from '../../store/runtimeSlice';
import { builderRegistry } from '../registry';

export const builderRuntimeStore = reduxStateStore({
  store,
  selector: (state: RootState) => state.runtime,
  dispatch: (nextState, reduxStore) => {
    reduxStore.dispatch(replaceRuntimeState(nextState));
  },
});

const setRuntimeState: SetState = (updater) => {
  const currentState = builderRuntimeStore.getSnapshot() as Record<string, unknown>;
  const nextState = updater(currentState);
  store.dispatch(replaceRuntimeState(nextState));
};

export const builderRuntimeHandlers = builderRegistry.handlers(
  () => setRuntimeState,
  () => builderRuntimeStore.getSnapshot(),
);
