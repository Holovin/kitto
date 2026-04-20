import { describe, expect, it } from 'vitest';
import { formatHistoryVersionChatMessage, getBuilderHistoryVersionState } from '@features/builder/historyVersionState';

describe('getBuilderHistoryVersionState', () => {
  it('shows a dash and disables undo on an empty canvas', () => {
    expect(
      getBuilderHistoryVersionState({
        committedSource: '',
        hasRedoSnapshot: false,
        hasRejectedDefinition: false,
        hasUndoSnapshot: false,
        historyVersionCount: 0,
        isStreaming: false,
        redoVersionCount: 0,
      }),
    ).toEqual({
      canRedo: false,
      canReset: false,
      canUndo: false,
      currentVersionNumber: 0,
      totalVersionCount: 0,
      versionBadgeText: '—',
    });
  });

  it('counts only committed non-empty versions for the current position', () => {
    expect(
      getBuilderHistoryVersionState({
        committedSource: 'root = AppShell([])',
        hasRedoSnapshot: true,
        hasRejectedDefinition: false,
        hasUndoSnapshot: true,
        historyVersionCount: 1,
        isStreaming: false,
        redoVersionCount: 1,
      }),
    ).toEqual({
      canRedo: true,
      canReset: true,
      canUndo: true,
      currentVersionNumber: 1,
      totalVersionCount: 2,
      versionBadgeText: '1 / 2',
    });
  });

  it('shows version 0 when the current canvas is empty but prior versions exist', () => {
    expect(
      getBuilderHistoryVersionState({
        committedSource: '',
        hasRedoSnapshot: true,
        hasRejectedDefinition: false,
        hasUndoSnapshot: false,
        historyVersionCount: 0,
        isStreaming: false,
        redoVersionCount: 2,
      }),
    ).toEqual({
      canRedo: true,
      canReset: true,
      canUndo: false,
      currentVersionNumber: 0,
      totalVersionCount: 2,
      versionBadgeText: '0 / 2',
    });
  });

  it('keeps undo, redo, and reset available during a request so they can abort and replace the active generation', () => {
    expect(
      getBuilderHistoryVersionState({
        committedSource: 'root = AppShell([])',
        hasRedoSnapshot: true,
        hasRejectedDefinition: false,
        hasUndoSnapshot: true,
        historyVersionCount: 3,
        isStreaming: true,
        redoVersionCount: 0,
      }),
    ).toEqual({
      canRedo: true,
      canReset: true,
      canUndo: true,
      currentVersionNumber: 3,
      totalVersionCount: 3,
      versionBadgeText: '3 / 3',
    });
  });

  it('formats undo and redo chat messages with the visible version number', () => {
    const versionState = getBuilderHistoryVersionState({
      committedSource: '',
      hasRedoSnapshot: true,
      hasRejectedDefinition: false,
      hasUndoSnapshot: false,
      historyVersionCount: 0,
      isStreaming: false,
      redoVersionCount: 2,
    });

    expect(formatHistoryVersionChatMessage('undo', versionState)).toBe('Reverted to version 0 / 2.');
    expect(formatHistoryVersionChatMessage('redo', versionState)).toBe('Restored version 0 / 2.');
  });

  it('keeps reset enabled when a rejected cached definition is visible without valid history', () => {
    expect(
      getBuilderHistoryVersionState({
        committedSource: '',
        hasRedoSnapshot: false,
        hasRejectedDefinition: true,
        hasUndoSnapshot: false,
        historyVersionCount: 0,
        isStreaming: false,
        redoVersionCount: 0,
      }),
    ).toEqual({
      canRedo: false,
      canReset: true,
      canUndo: false,
      currentVersionNumber: 0,
      totalVersionCount: 0,
      versionBadgeText: '—',
    });
  });

  it('keeps reset enabled when a visible definition exists without valid history', () => {
    expect(
      getBuilderHistoryVersionState({
        committedSource: 'root = AppShell([])',
        hasRedoSnapshot: false,
        hasRejectedDefinition: false,
        hasUndoSnapshot: false,
        historyVersionCount: 0,
        isStreaming: false,
        redoVersionCount: 0,
      }),
    ).toEqual({
      canRedo: false,
      canReset: true,
      canUndo: false,
      currentVersionNumber: 0,
      totalVersionCount: 0,
      versionBadgeText: '—',
    });
  });

  it('keeps reset disabled only for a pristine empty builder state', () => {
    expect(
      getBuilderHistoryVersionState({
        committedSource: '',
        hasRedoSnapshot: false,
        hasRejectedDefinition: false,
        hasUndoSnapshot: false,
        historyVersionCount: 0,
        isStreaming: false,
        redoVersionCount: 0,
      }),
    ).toEqual({
      canRedo: false,
      canReset: false,
      canUndo: false,
      currentVersionNumber: 0,
      totalVersionCount: 0,
      versionBadgeText: '—',
    });
  });
});
