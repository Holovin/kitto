import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Spec } from '@json-render/core';
import type { BuilderMessage, BuilderSnapshot } from '../utils/state';

type BuilderRequestState = {
  status: 'idle' | 'streaming' | 'error';
  error: string | null;
};

const MAX_HISTORY_ENTRIES = 10;

export type BuilderState = {
  spec: Spec | null;
  history: BuilderSnapshot[];
  future: BuilderSnapshot[];
  messages: BuilderMessage[];
  lastPrompt: string;
  request: BuilderRequestState;
};

function createInitialMessages(): BuilderMessage[] {
  return [];
}

export function createInitialBuilderState(): BuilderState {
  return {
    spec: null,
    history: [],
    future: [],
    messages: createInitialMessages(),
    lastPrompt: '',
    request: {
      status: 'idle',
      error: null,
    },
  };
}

function isValidRequestStatus(value: unknown): value is BuilderRequestState['status'] {
  return value === 'idle' || value === 'streaming' || value === 'error';
}

export function normalizeBuilderState(state: Partial<BuilderState> | undefined): BuilderState {
  const initialState = createInitialBuilderState();

  if (!state) {
    return initialState;
  }

  return {
    spec: ('spec' in state ? (state.spec as Spec | null) : initialState.spec) ?? null,
    history: Array.isArray(state.history) ? state.history : initialState.history,
    future: Array.isArray(state.future) ? state.future : initialState.future,
    messages: Array.isArray(state.messages) ? state.messages : initialState.messages,
    lastPrompt: typeof state.lastPrompt === 'string' ? state.lastPrompt : initialState.lastPrompt,
    request: {
      status: isValidRequestStatus(state.request?.status) ? state.request.status : initialState.request.status,
      error: typeof state.request?.error === 'string' || state.request?.error === null ? state.request.error : initialState.request.error,
    },
  };
}

const initialState: BuilderState = createInitialBuilderState();

export const builderSlice = createSlice({
  name: 'builder',
  initialState,
  reducers: {
    setBuilderSpec(state, action: PayloadAction<Spec | null>) {
      state.spec = action.payload;
    },
    appendMessage(state, action: PayloadAction<BuilderMessage>) {
      state.messages.push(action.payload);
    },
    replaceMessages(state, action: PayloadAction<BuilderMessage[]>) {
      state.messages = action.payload;
    },
    startGeneration(state, action: PayloadAction<{ prompt: string }>) {
      state.lastPrompt = action.payload.prompt;
      state.request.status = 'streaming';
      state.request.error = null;
    },
    finishGeneration(state) {
      state.request.status = 'idle';
      state.request.error = null;
    },
    failGeneration(state, action: PayloadAction<string>) {
      state.request.status = 'error';
      state.request.error = action.payload;
    },
    enqueueSnapshot(state, action: PayloadAction<BuilderSnapshot>) {
      state.history.push(action.payload);
      state.future = [];

      if (state.history.length > MAX_HISTORY_ENTRIES) {
        state.history.shift();
      }
    },
    restoreSnapshot(state, action: PayloadAction<{ target: BuilderSnapshot; current: BuilderSnapshot }>) {
      state.spec = action.payload.target.spec;
      state.lastPrompt = action.payload.target.prompt;
      state.request.status = 'idle';
      state.request.error = null;
      state.history.pop();
      state.future.push(action.payload.current);

      if (state.future.length > MAX_HISTORY_ENTRIES) {
        state.future.shift();
      }
    },
    reapplySnapshot(state, action: PayloadAction<{ target: BuilderSnapshot; current: BuilderSnapshot }>) {
      state.spec = action.payload.target.spec;
      state.lastPrompt = action.payload.target.prompt;
      state.request.status = 'idle';
      state.request.error = null;
      state.future.pop();
      state.history.push(action.payload.current);

      if (state.history.length > MAX_HISTORY_ENTRIES) {
        state.history.shift();
      }
    },
    resetBuilderState() {
      return createInitialBuilderState();
    },
  },
});

export const {
  appendMessage,
  enqueueSnapshot,
  failGeneration,
  finishGeneration,
  reapplySnapshot,
  replaceMessages,
  resetBuilderState,
  restoreSnapshot,
  setBuilderSpec,
  startGeneration,
} = builderSlice.actions;

export const builderReducer = builderSlice.reducer;
