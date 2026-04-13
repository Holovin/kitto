import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

interface BuilderSessionState {
  runtimeSessionState: Record<string, unknown>;
}

const initialState: BuilderSessionState = {
  runtimeSessionState: {},
};

export function normalizeBuilderSessionState(
  value: unknown,
  fallbackRuntimeState: Record<string, unknown> = {},
): BuilderSessionState {
  if (!isRecord(value)) {
    return {
      runtimeSessionState: structuredClone(fallbackRuntimeState),
    };
  }

  const runtimeSessionState = isRecord(value.runtimeSessionState)
    ? value.runtimeSessionState
    : isRecord(value.runtimeState)
      ? value.runtimeState
      : fallbackRuntimeState;

  return {
    runtimeSessionState: structuredClone(runtimeSessionState),
  };
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
