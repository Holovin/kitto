import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { buildEmptyRuntimeState, ensureRuntimeShape, type BuilderRuntimeState } from '../utils/state';

const initialState = buildEmptyRuntimeState();

export const runtimeSlice = createSlice({
  name: 'runtime',
  initialState,
  reducers: {
    replaceRuntimeState: (_state, action: PayloadAction<Record<string, unknown>>) =>
      ensureRuntimeShape(action.payload as Partial<BuilderRuntimeState>),
    resetRuntimeState: () => buildEmptyRuntimeState(),
  },
});

export const { replaceRuntimeState, resetRuntimeState } = runtimeSlice.actions;
export const runtimeReducer = runtimeSlice.reducer;
