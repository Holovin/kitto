import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { DEFAULT_DOMAIN_DATA } from './defaults';
import { appendPathValue, mergePathValue, removePathValue, writePathValue } from './path';

interface DomainState {
  data: Record<string, unknown>;
}

const initialState: DomainState = {
  data: structuredClone(DEFAULT_DOMAIN_DATA),
};

export function normalizeDomainState(
  value: unknown,
  fallbackData: Record<string, unknown> = DEFAULT_DOMAIN_DATA,
): DomainState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      data: structuredClone(fallbackData),
    };
  }

  const candidateData = (value as { data?: unknown }).data;

  return {
    data:
      candidateData && typeof candidateData === 'object' && !Array.isArray(candidateData)
        ? (candidateData as Record<string, unknown>)
        : structuredClone(fallbackData),
  };
}

export const domainSlice = createSlice({
  name: 'domain',
  initialState,
  reducers: {
    replaceData(state, action: PayloadAction<Record<string, unknown>>) {
      state.data = structuredClone(action.payload);
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
      state.data = structuredClone(DEFAULT_DOMAIN_DATA);
    },
  },
});

export const domainActions = domainSlice.actions;
export const domainReducer = domainSlice.reducer;
