import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  cloneJsonCompatibleValue,
  isPlainObject,
  validatePersistedStateObjectKeys,
  validatePersistedStateTree,
} from './path';

export interface BuilderSessionState {
  runtimeSessionState: Record<string, unknown>;
}

export interface RestoredBuilderSessionValidationResult {
  reason: string | null;
  state: BuilderSessionState | null;
}

const initialState: BuilderSessionState = {
  runtimeSessionState: {},
};

function createBuilderSessionState(runtimeSessionState: Record<string, unknown>): BuilderSessionState {
  return {
    runtimeSessionState: cloneJsonCompatibleValue(runtimeSessionState) as Record<string, unknown>,
  };
}

export function validateRestoredBuilderSessionResult(value: unknown): RestoredBuilderSessionValidationResult {
  if (!isPlainObject(value)) {
    return {
      reason: 'builderSession must be a plain object.',
      state: null,
    };
  }

  const wrapperFailure = validatePersistedStateObjectKeys(value, 'builderSession');

  if (wrapperFailure) {
    return {
      reason: wrapperFailure,
      state: null,
    };
  }

  if (isPlainObject(value.runtimeSessionState)) {
    const failure = validatePersistedStateTree(value.runtimeSessionState, {
      label: 'builderSession.runtimeSessionState',
    });

    if (failure) {
      return {
        reason: failure,
        state: null,
      };
    }

    return {
      reason: null,
      state: createBuilderSessionState(value.runtimeSessionState),
    };
  }

  return {
    reason: 'builderSession must include a plain-object runtimeSessionState.',
    state: null,
  };
}

export function validateRestoredBuilderSession(value: unknown): BuilderSessionState | null {
  return validateRestoredBuilderSessionResult(value).state;
}

export function normalizeBuilderSessionState(
  value: unknown,
  fallbackRuntimeState: Record<string, unknown> = {},
): BuilderSessionState {
  return validateRestoredBuilderSession(value) ?? createBuilderSessionState(fallbackRuntimeState);
}

export const builderSessionSlice = createSlice({
  name: 'builderSession',
  initialState,
  reducers: {
    replaceRuntimeSessionState(state, action: PayloadAction<Record<string, unknown>>) {
      state.runtimeSessionState = structuredClone(action.payload);
    },
    resetRuntimeSessionState(state) {
      state.runtimeSessionState = {};
    },
  },
});

export const builderSessionActions = builderSessionSlice.actions;
export const builderSessionReducer = builderSessionSlice.reducer;
