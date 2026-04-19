import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { DEFAULT_DOMAIN_DATA } from './defaults';
import { appendPathValue, clonePlainObject, mergePathValue, removePathValue, writePathValue } from './path';

interface DomainState {
  data: Record<string, unknown>;
}

const initialState: DomainState = {
  data: clonePlainObject(DEFAULT_DOMAIN_DATA, 'Domain data must be a plain object.'),
};

export function normalizeDomainState(
  value: unknown,
  fallbackData: Record<string, unknown> = DEFAULT_DOMAIN_DATA,
): DomainState {
  const safeFallbackData = clonePlainObject(fallbackData, 'Domain data must be a plain object.');

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      data: safeFallbackData,
    };
  }

  const candidateData = (value as { data?: unknown }).data;

  try {
    if (candidateData && typeof candidateData === 'object' && !Array.isArray(candidateData)) {
      return {
        data: clonePlainObject(candidateData, 'Domain data must be a plain object.'),
      };
    }
  } catch {
    return {
      data: safeFallbackData,
    };
  }

  return {
    data: safeFallbackData,
  };
}

export const domainSlice = createSlice({
  name: 'domain',
  initialState,
  reducers: {
    replaceData(state, action: PayloadAction<Record<string, unknown>>) {
      state.data = clonePlainObject(action.payload, 'Domain data must be a plain object.');
    },
    writeState(state, action: PayloadAction<{ path: string; value: unknown }>) {
      state.data = writePathValue(state.data, action.payload.path, action.payload.value);
    },
    mergeState(state, action: PayloadAction<{ path: string; patch: Record<string, unknown> }>) {
      state.data = mergePathValue(state.data, action.payload.path, action.payload.patch);
    },
    appendState(state, action: PayloadAction<{ path: string; value: unknown }>) {
      state.data = appendPathValue(state.data, action.payload.path, action.payload.value);
    },
    removeState(state, action: PayloadAction<{ index: number; path: string }>) {
      state.data = removePathValue(state.data, action.payload.path, action.payload.index);
    },
    resetDomainState(state) {
      state.data = clonePlainObject(DEFAULT_DOMAIN_DATA, 'Domain data must be a plain object.');
    },
  },
});

export const domainActions = domainSlice.actions;
export const domainReducer = domainSlice.reducer;
