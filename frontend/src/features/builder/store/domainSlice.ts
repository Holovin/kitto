import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { DEFAULT_DOMAIN_DATA } from './defaults';
import {
  appendPathValue,
  clonePersistedDomainData,
  isPlainObject,
  mergePathValue,
  removePathValue,
  validatePersistedStateObjectKeys,
  validatePersistedStateTree,
  writePathValue,
} from './path';

export interface DomainState {
  data: Record<string, unknown>;
}

export interface RestoredDomainValidationResult {
  reason: string | null;
  state: DomainState | null;
}

const initialState: DomainState = {
  data: clonePersistedDomainData(DEFAULT_DOMAIN_DATA),
};

function createDomainState(data: Record<string, unknown>): DomainState {
  return {
    data: clonePersistedDomainData(data),
  };
}

export function validateRestoredDomainResult(value: unknown): RestoredDomainValidationResult {
  if (!isPlainObject(value)) {
    return {
      reason: 'domain must be a plain object.',
      state: null,
    };
  }

  const wrapperFailure = validatePersistedStateObjectKeys(value, 'domain');

  if (wrapperFailure) {
    return {
      reason: wrapperFailure,
      state: null,
    };
  }

  const candidateData = value.data;
  const label = 'domain.data';

  if (!isPlainObject(candidateData)) {
    return {
      reason: `${label} must be a plain object.`,
      state: null,
    };
  }

  const failure = validatePersistedStateTree(candidateData, { label });

  if (failure) {
    return {
      reason: failure,
      state: null,
    };
  }

  return {
    reason: null,
    state: createDomainState(candidateData),
  };
}

export function validateRestoredDomain(value: unknown): DomainState | null {
  return validateRestoredDomainResult(value).state;
}

export function normalizeDomainState(
  value: unknown,
  fallbackData: Record<string, unknown> = DEFAULT_DOMAIN_DATA,
): DomainState {
  const safeFallbackData = clonePersistedDomainData(fallbackData);
  return validateRestoredDomain(value) ?? createDomainState(safeFallbackData);
}

export const domainSlice = createSlice({
  name: 'domain',
  initialState,
  reducers: {
    replaceData(state, action: PayloadAction<Record<string, unknown>>) {
      state.data = clonePersistedDomainData(action.payload);
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
      state.data = clonePersistedDomainData(DEFAULT_DOMAIN_DATA);
    },
  },
});

export const domainActions = domainSlice.actions;
export const domainReducer = domainSlice.reducer;
