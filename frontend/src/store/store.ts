import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { rememberEnhancer, rememberReducer } from 'redux-remember';
import { apiSlice } from '@api/apiSlice';
import { builderReducer, normalizeBuilderState } from '@features/builder/store/builderSlice';
import { builderSessionReducer, normalizeBuilderSessionState } from '@features/builder/store/builderSessionSlice';
import { domainReducer, normalizeDomainState } from '@features/builder/store/domainSlice';

const combinedReducer = combineReducers({
  builder: builderReducer,
  builderSession: builderSessionReducer,
  domain: domainReducer,
  [apiSlice.reducerPath]: apiSlice.reducer,
});

const rootReducer = rememberReducer(combinedReducer);

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(apiSlice.middleware),
  enhancers: (getDefaultEnhancers) =>
    getDefaultEnhancers().concat(
      rememberEnhancer(window.localStorage, ['builder'], {
        migrate: async (state) => {
          const builder = normalizeBuilderState(state.builder);
          const latestSnapshot = builder.history.at(-1);

          return {
            ...state,
            builder,
            builderSession: normalizeBuilderSessionState(state.builderSession, latestSnapshot?.runtimeState ?? {}),
            domain: normalizeDomainState(state.domain, latestSnapshot?.domainData ?? {}),
          };
        },
      }),
    ),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
