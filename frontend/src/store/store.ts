import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { rememberEnhancer, rememberReducer } from 'redux-remember';
import { apiSlice } from '@api/apiSlice';
import { builderReducer, normalizeBuilderState } from '@features/builder/store/builderSlice';
import { domainReducer, normalizeDomainState } from '@features/builder/store/domainSlice';

const combinedReducer = combineReducers({
  builder: builderReducer,
  domain: domainReducer,
  [apiSlice.reducerPath]: apiSlice.reducer,
});

const rootReducer = rememberReducer(combinedReducer);

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(apiSlice.middleware),
  enhancers: (getDefaultEnhancers) =>
    getDefaultEnhancers().concat(
      rememberEnhancer(window.localStorage, ['builder', 'domain'], {
        migrate: async (state) => ({
          ...state,
          builder: normalizeBuilderState(state.builder),
          domain: normalizeDomainState(state.domain),
        }),
      }),
    ),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
