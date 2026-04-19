import type { RootState } from '@store/store';

export const selectActiveTab = (state: RootState) => state.builder.activeTab;
export const selectChatMessages = (state: RootState) => state.builder.chatMessages;
export const selectCommittedSource = (state: RootState) => state.builder.committedSource;
export const selectDomainData = (state: RootState) => state.domain.data;
export const selectDraftPrompt = (state: RootState) => state.builder.draftPrompt;
export const selectHistory = (state: RootState) => state.builder.history;
export const selectIsStreaming = (state: RootState) => state.builder.isStreaming;
export const selectParseIssues = (state: RootState) => state.builder.parseIssues;
export const selectRedoHistory = (state: RootState) => state.builder.redoHistory;
export const selectRuntimeSessionState = (state: RootState) => state.builderSession.runtimeSessionState;
export const selectStreamedSource = (state: RootState) => state.builder.streamedSource;
