import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { rememberEnhancer, rememberReducer } from 'redux-remember';
import { apiSlice } from '@api/apiSlice';
import { builderReducer, normalizeBuilderState, type BuilderState } from '@features/builder/store/builderSlice';
import { runtimeReducer } from '@features/builder/store/runtimeSlice';
import { ensureRuntimeShape, type BuilderRuntimeState } from '@features/builder/utils/state';
import { settingsReducer } from './settingsSlice';

export const REMEMBER_PREFIX = '@@remember-';
export const REMEMBERED_SLICE_KEYS = ['settings', 'builder', 'runtime'] as const;
export const BUILDER_RESET_SLICE_KEYS = ['builder', 'runtime'] as const;

const safeBuilderReducer = (state: BuilderState | undefined, action: Parameters<typeof builderReducer>[1]) =>
  builderReducer(normalizeBuilderState(state), action);

const safeRuntimeReducer = (state: BuilderRuntimeState | undefined, action: Parameters<typeof runtimeReducer>[1]) =>
  runtimeReducer(ensureRuntimeShape(state), action);

const combinedReducer = combineReducers({
  builder: safeBuilderReducer,
  runtime: safeRuntimeReducer,
  settings: settingsReducer,
  [apiSlice.reducerPath]: apiSlice.reducer,
});

const rootReducer = rememberReducer(combinedReducer);

export function clearRememberedSlices(keys: readonly string[]) {
  for (const key of keys) {
    window.localStorage.removeItem(`${REMEMBER_PREFIX}${key}`);
  }
}

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(apiSlice.middleware),
  enhancers: (getDefaultEnhancers) =>
    getDefaultEnhancers().concat(rememberEnhancer(window.localStorage, [...REMEMBERED_SLICE_KEYS])),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
