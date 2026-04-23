import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { rememberEnhancer, rememberReducer } from 'redux-remember';
import { apiSlice } from '@api/apiSlice';
import { builderReducer } from '@features/builder/store/builderSlice';
import { builderSessionReducer } from '@features/builder/store/builderSessionSlice';
import { domainReducer } from '@features/builder/store/domainSlice';
import { REMEMBER_KEYS, REMEMBER_PREFIX, unserializeRememberedState } from './persistence';

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
      rememberEnhancer(window.localStorage, [...REMEMBER_KEYS], {
        prefix: REMEMBER_PREFIX,
        unserialize: unserializeRememberedState,
      }),
    ),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
