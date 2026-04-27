import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Renderer } from '@openuidev/react-lang';
import { escapeStringLiteralBackticksForParser } from '@kitto-openui/shared/openuiAst.js';
import { Download, FileUp, LoaderCircle, MoreHorizontal, RotateCcw } from 'lucide-react';
import { ErrorBoundary } from 'react-error-boundary';
import { Button } from '@components/ui/button';
import { Card, CardContent } from '@components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs';
import { DefinitionPanel } from '@pages/Chat/builder/components/DefinitionPanel';
import { PreviewEmptyState } from '@pages/Chat/builder/components/PreviewEmptyState';
import { PreviewErrorFallback } from '@pages/Chat/builder/components/PreviewErrorFallback';
import { resolvePreviewCanvasState } from '@pages/Chat/builder/components/previewCanvasState';
import { PreviewUnavailableState } from '@pages/Chat/builder/components/PreviewUnavailableState';
import { useBuilderHistoryControls } from '@pages/Chat/builder/hooks/useBuilderHistoryControls';
import { builderOpenUiLibrary } from '@pages/Chat/builder/openui/library';
import { handleOpenUiActionEvent } from '@pages/Chat/builder/openui/runtime/actionEvents';
import {
  combinePreviewIssues,
  createRendererCrashIssue,
  mapOpenUiErrorsToIssues,
  mapParseResultToIssues,
  shouldResetRuntimeIssues,
} from '@pages/Chat/builder/openui/runtime/issues';
import { createBuilderToolProvider } from '@pages/Chat/builder/openui/runtime/toolProvider';
import {
  selectActiveTab,
  selectDefinitionWarnings,
  selectDefinitionSource,
  selectDomainData,
  selectHasRejectedDefinition,
  selectHistory,
  selectIsStreaming,
  selectLastStreamChunkAt,
  selectParseIssues,
  selectPreviewSource,
  selectRuntimeSessionState,
  selectStreamedSource,
} from '@pages/Chat/builder/store/selectors';
import { builderActions } from '@pages/Chat/builder/store/builderSlice';
import { builderSessionActions } from '@pages/Chat/builder/store/builderSessionSlice';
import { domainActions } from '@pages/Chat/builder/store/domainSlice';
import { clonePersistedDomainData, clonePersistedRuntimeState } from '@pages/Chat/builder/store/path';
import type { BuilderChatNotice, PromptBuildValidationIssue, BuilderTabId } from '@pages/Chat/builder/types';
import { useAppDispatch, useAppSelector } from '@store/hooks';

type ScopedRuntimeIssues = {
  issues: PromptBuildValidationIssue[];
  scope: string;
};

interface PreviewTabsProps {
  onSystemNotice: (notice: BuilderChatNotice | null) => void;
}

interface PreviewStreamingOverlayProps {
  isPreviewEmptyCanvas: boolean;
  lastStreamChunkAt: number | null;
  streamedSourceBytes: number;
}

type StreamingTimerTick = {
  clockMs: number;
  startedAt: number;
};

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function createDomainDataCell(initialData: Record<string, unknown>) {
  let currentData = initialData;

  return {
    read: () => currentData,
    replace: (nextData: Record<string, unknown>) => {
      currentData = nextData;
    },
  };
}

const textEncoder = new TextEncoder();
const STREAM_ACTIVE_WINDOW_MS = 2_500;

function getByteLength(value: string) {
  return textEncoder.encode(value).byteLength;
}

function formatByteCount(bytes: number) {
  if (bytes < 1_024) {
    return `${new Intl.NumberFormat().format(bytes)} B`;
  }

  if (bytes < 1_048_576) {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1_024)} KB`;
  }

  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1_048_576)} MB`;
}

function PreviewStreamingOverlay({ isPreviewEmptyCanvas, lastStreamChunkAt, streamedSourceBytes }: PreviewStreamingOverlayProps) {
  const [timerTick, setTimerTick] = useState<StreamingTimerTick | null>(null);

  useEffect(() => {
    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      setTimerTick({
        clockMs: Date.now(),
        startedAt,
      });
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const previewOverlayLabel = isPreviewEmptyCanvas ? 'Generating...' : 'Updating...';
  const elapsedStreamingSeconds = timerTick ? Math.floor((timerTick.clockMs - timerTick.startedAt) / 1_000) : 0;
  const previewOverlayTimerLabel = `${elapsedStreamingSeconds}s elapsed`;
  const streamAgeMs = lastStreamChunkAt === null ? null : Math.max(0, (timerTick?.clockMs ?? lastStreamChunkAt) - lastStreamChunkAt);
  const previewOverlayStatusLabel =
    lastStreamChunkAt === null
      ? 'Waiting for first chunk'
      : streamAgeMs !== null && streamAgeMs <= STREAM_ACTIVE_WINDOW_MS
        ? 'Stream active'
        : 'Finalizing response';
  const previewOverlayPrimaryLabel = `${previewOverlayLabel} · ${previewOverlayTimerLabel}`;
  const previewOverlaySecondaryLabel = `${previewOverlayStatusLabel} · ${formatByteCount(streamedSourceBytes)} draft`;

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[1.75rem] bg-white/60 backdrop-blur-[1px]">
      <div
        aria-live="polite"
        className="flex min-w-[350px] items-center gap-3 rounded-full border border-slate-200/80 bg-white/90 px-5 py-4 text-slate-900 shadow-lg"
        role="status"
      >
        <LoaderCircle className="h-7 w-7 animate-spin" />
        <div className="flex flex-col">
          <span className="text-sm font-medium">{previewOverlayPrimaryLabel}</span>
          <span className="text-xs text-slate-500">{previewOverlaySecondaryLabel}</span>
        </div>
      </div>
    </div>
  );
}

export function PreviewTabs({ onSystemNotice }: PreviewTabsProps) {
  const dispatch = useAppDispatch();
  const activeTab = useAppSelector(selectActiveTab);
  const definitionWarnings = useAppSelector(selectDefinitionWarnings);
  const definitionSource = useAppSelector(selectDefinitionSource);
  const domainData = useAppSelector(selectDomainData);
  const history = useAppSelector(selectHistory);
  const isShowingRejectedDefinition = useAppSelector(selectHasRejectedDefinition);
  const isStreaming = useAppSelector(selectIsStreaming);
  const lastStreamChunkAt = useAppSelector(selectLastStreamChunkAt);
  const parseIssues = useAppSelector(selectParseIssues);
  const previewSource = useAppSelector(selectPreviewSource);
  const runtimeSessionState = useAppSelector(selectRuntimeSessionState);
  const streamedSource = useAppSelector(selectStreamedSource);
  const [scopedRuntimeIssues, setScopedRuntimeIssues] = useState<ScopedRuntimeIssues>({
    issues: [],
    scope: '',
  });
  const [rendererResetVersion, setRendererResetVersion] = useState(0);
  const currentSnapshot = history.at(-1);
  const currentSnapshotCommittedAt = currentSnapshot?.committedAt ?? '';
  const previewRenderInput = useMemo(
    () => ({
      key: `${history.length}:${currentSnapshotCommittedAt}:${previewSource}`,
      source: previewSource,
    }),
    [currentSnapshotCommittedAt, history.length, previewSource],
  );
  const deferredPreviewRender = useDeferredValue(previewRenderInput);
  const deferredPreviewSource = deferredPreviewRender.source;
  const deferredPreviewParserSource = useMemo(
    () => escapeStringLiteralBackticksForParser(deferredPreviewSource),
    [deferredPreviewSource],
  );
  const isPreviewSynchronized = deferredPreviewSource === previewSource;
  const previewCanvasState = resolvePreviewCanvasState({
    isShowingRejectedDefinition,
    previewSource: deferredPreviewSource,
  });
  const isPreviewEmptyCanvas = previewCanvasState !== 'preview';
  const isPreviewUnavailable = previewCanvasState === 'unavailable';
  const isEmptyCanvas = previewCanvasState === 'empty';
  const resolvedActiveTab = isEmptyCanvas && activeTab !== 'preview' ? 'preview' : activeTab;
  const runtimeIssueScope = `${history.length}:${currentSnapshot?.committedAt ?? ''}:${previewSource}:${isShowingRejectedDefinition ? 'rejected' : 'preview'}:${rendererResetVersion}`;
  const runtimeIssues = scopedRuntimeIssues.scope === runtimeIssueScope ? scopedRuntimeIssues.issues : [];
  const toolProvider = useMemo(
    () => {
      const domainDataCell = createDomainDataCell(domainData);

      return createBuilderToolProvider({
        readDomainData: domainDataCell.read,
        replaceDomainData: (nextData) => {
          domainDataCell.replace(nextData);
          dispatch(domainActions.replaceData(nextData));
        },
        syncLatestSnapshotDomainData: (nextData) => {
          dispatch(builderActions.syncLatestSnapshotState({ domainData: nextData }));
        },
      });
    },
    [dispatch, domainData],
  );
  const combinedIssues = combinePreviewIssues({
    isPreviewEmptyCanvas,
    isShowingRejectedDefinition,
    parseIssues,
    runtimeIssues,
  });
  const streamedSourceBytes = getByteLength(streamedSource);
  const previousPreviewRef = useRef<{
    isShowingRejectedDefinition: boolean;
    previewSource: string;
  } | null>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
  const {
    canExport,
    canDownloadStandalone,
    fileInputRef,
    preloadStandaloneHtml,
    handleDownloadStandalone,
    handleExport,
    handleImport,
  } = useBuilderHistoryControls({
    onSystemNotice,
  });
  const toolbarButtonClassName =
    'h-11 w-11 rounded-full border border-slate-200 bg-white/80 p-0 text-slate-700 shadow-none hover:bg-white hover:text-slate-950';
  const fileMenuItemClassName =
    'flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent disabled:hover:text-slate-400';

  useEffect(() => {
    if (!isEmptyCanvas || activeTab === 'preview') {
      return;
    }

    dispatch(builderActions.setActiveTab('preview'));
  }, [activeTab, dispatch, isEmptyCanvas]);

  useEffect(() => {
    const previousPreview = previousPreviewRef.current;
    previousPreviewRef.current = {
      isShowingRejectedDefinition,
      previewSource,
    };

    if (
      !shouldResetRuntimeIssues({
        nextPreviewSource: previewSource,
        nextRejectedDefinition: isShowingRejectedDefinition,
        previousPreviewSource: previousPreview?.previewSource ?? null,
        previousRejectedDefinition: previousPreview?.isShowingRejectedDefinition ?? null,
      })
    ) {
      return;
    }

    if (!isShowingRejectedDefinition) {
      dispatch(builderActions.setParseIssues([]));
    }
  }, [dispatch, isShowingRejectedDefinition, previewSource]);

  const handleRuntimeStateUpdate = useCallback(
    (state: unknown) => {
      const nextState = state as Record<string, unknown>;
      dispatch(builderSessionActions.replaceRuntimeSessionState(nextState));
      dispatch(builderActions.syncLatestSnapshotState({ runtimeState: nextState }));
    },
    [dispatch],
  );

  useEffect(() => {
    if (!isFileMenuOpen) {
      return;
    }

    if (canDownloadStandalone) {
      preloadStandaloneHtml();
    }

    function handlePointerDown(event: MouseEvent) {
      if (fileMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsFileMenuOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsFileMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [canDownloadStandalone, isFileMenuOpen, preloadStandaloneHtml]);

  function handleResetAppState() {
    if (!currentSnapshot || isStreaming) {
      return;
    }

    const nextDomainData = clonePersistedDomainData(currentSnapshot.initialDomainData);
    const nextRuntimeState = clonePersistedRuntimeState(currentSnapshot.initialRuntimeState);

    dispatch(domainActions.replaceData(nextDomainData));
    dispatch(builderSessionActions.replaceRuntimeSessionState(nextRuntimeState));
    dispatch(
      builderActions.syncLatestSnapshotState({
        domainData: nextDomainData,
        runtimeState: nextRuntimeState,
      }),
    );
    dispatch(builderActions.resetCurrentAppState());
    setRendererResetVersion((currentValue) => currentValue + 1);
  }

  return (
    <Tabs
      value={resolvedActiveTab}
      onValueChange={(value: string) => {
        if (isEmptyCanvas && value !== 'preview') {
          return;
        }

        dispatch(builderActions.setActiveTab(value as BuilderTabId));
      }}
      className="flex h-full min-h-0 flex-col gap-2 pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="definition" disabled={isEmptyCanvas}>
            Definition
          </TabsTrigger>
          <TabsTrigger value="app-state" disabled={isPreviewEmptyCanvas}>
            App State
          </TabsTrigger>
        </TabsList>
        <div ref={fileMenuRef} className="relative">
          <Button
            aria-label="File actions"
            aria-expanded={isFileMenuOpen}
            aria-haspopup="menu"
            className={toolbarButtonClassName}
            variant="ghost"
            onFocus={() => {
              if (canDownloadStandalone) {
                preloadStandaloneHtml();
              }
            }}
            onMouseEnter={() => {
              if (canDownloadStandalone) {
                preloadStandaloneHtml();
              }
            }}
            onClick={() => setIsFileMenuOpen((currentValue) => !currentValue)}
          >
            <MoreHorizontal className="h-5 w-5" />
          </Button>
          {isFileMenuOpen ? (
            <div
              className="absolute right-0 top-full z-20 mt-2 min-w-[18.25rem] rounded-[1.25rem] border border-slate-200 bg-white p-1 shadow-lg"
              role="menu"
            >
              <button
                className={fileMenuItemClassName}
                type="button"
                onClick={() => {
                  setIsFileMenuOpen(false);
                  fileInputRef.current?.click();
                }}
              >
                <FileUp className="h-4 w-4" />
                Import JSON
              </button>
              <button
                className={fileMenuItemClassName}
                disabled={!canExport}
                type="button"
                onClick={() => {
                  handleExport();
                  setIsFileMenuOpen(false);
                }}
              >
                <Download className="h-4 w-4" />
                Export JSON
              </button>
              <div aria-hidden="true" className="my-1 h-px bg-slate-200" role="separator" />
              <button
                className={fileMenuItemClassName}
                disabled={!canDownloadStandalone}
                type="button"
                onFocus={preloadStandaloneHtml}
                onMouseEnter={preloadStandaloneHtml}
                onClick={() => {
                  handleDownloadStandalone();
                  setIsFileMenuOpen(false);
                }}
              >
                <Download className="h-4 w-4" />
                Download standalone HTML
              </button>
            </div>
          ) : null}
          <input
            ref={fileInputRef}
            accept="application/json"
            className="hidden"
            id="builder-import-json"
            name="builder-import-json"
            type="file"
            onChange={handleImport}
          />
        </div>
      </div>

      <TabsContent value="preview" className="mt-0 flex-1 min-h-0">
        <Card className="h-full min-h-0 overflow-hidden border-0 bg-white/92">
          <CardContent className="h-full min-h-0 p-6">
            <div className="relative h-full min-h-0" aria-busy={isStreaming}>
              {isPreviewUnavailable ? (
                <div className="h-full min-h-0 overflow-y-auto rounded-[1.75rem] border border-rose-200/80 bg-rose-50/45 p-4 sm:p-6">
                  <PreviewUnavailableState />
                </div>
              ) : isPreviewEmptyCanvas ? (
                <div className="h-full min-h-0 overflow-y-auto rounded-[1.75rem] border border-slate-200/80 bg-slate-50/70 p-4 sm:p-6">
                  <PreviewEmptyState />
                </div>
              ) : (
                <div className="h-full min-h-0 overflow-y-auto p-4 sm:p-5">
                  <ErrorBoundary
                    fallbackRender={({ error }) => (
                      <PreviewErrorFallback
                        error={error}
                        onOpenDefinition={() => dispatch(builderActions.setActiveTab('definition'))}
                      />
                    )}
                    onError={(error) => {
                      if (!isPreviewSynchronized) {
                        return;
                      }

                      setScopedRuntimeIssues({
                        issues: [createRendererCrashIssue(error, 'preview-runtime-error', 'The committed preview crashed while rendering.')],
                        scope: runtimeIssueScope,
                      });
                    }}
                    resetKeys={[deferredPreviewRender.key, rendererResetVersion]}
                  >
                    <Renderer
                      key={`${deferredPreviewRender.key}:${rendererResetVersion}`}
                      initialState={runtimeSessionState}
                      isStreaming={isStreaming}
                      library={builderOpenUiLibrary}
                      onAction={handleOpenUiActionEvent}
                      onError={(errors) => {
                        if (!isPreviewSynchronized) {
                          return;
                        }

                        setScopedRuntimeIssues({
                          issues: mapOpenUiErrorsToIssues(errors),
                          scope: runtimeIssueScope,
                        });
                      }}
                      onParseResult={(result) => {
                        if (isShowingRejectedDefinition || !isPreviewSynchronized) {
                          return;
                        }

                        dispatch(builderActions.setParseIssues(mapParseResultToIssues(result)));
                      }}
                      onStateUpdate={handleRuntimeStateUpdate}
                      queryLoader={
                        <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                          Loading query...
                        </div>
                      }
                      response={deferredPreviewParserSource}
                      toolProvider={toolProvider}
                    />
                  </ErrorBoundary>
                </div>
              )}

              {isStreaming ? (
                <PreviewStreamingOverlay
                  isPreviewEmptyCanvas={isPreviewEmptyCanvas}
                  lastStreamChunkAt={lastStreamChunkAt}
                  streamedSourceBytes={streamedSourceBytes}
                />
              ) : null}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="definition" className="mt-0 flex-1 min-h-0">
        <DefinitionPanel issues={combinedIssues} source={definitionSource} warnings={definitionWarnings} />
      </TabsContent>

      <TabsContent value="app-state" className="mt-0 flex-1 min-h-0">
        <Card className="h-full min-h-0 overflow-hidden border-white/70 bg-white/92">
          <CardContent className="flex h-full min-h-0 flex-col gap-4 p-6">
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button
                className="h-8 rounded-lg border border-slate-200 px-3 text-xs shadow-none hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
                disabled={!currentSnapshot || isPreviewEmptyCanvas || isStreaming}
                size="sm"
                variant="secondary"
                onClick={handleResetAppState}
              >
                <RotateCcw className="h-4 w-4" />
                Reset app state
              </Button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <div className="flex min-w-0 flex-col gap-3">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Reactive state</p>
                <pre className="max-h-[22rem] w-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-[1.25rem] bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                  <code>{formatJson(runtimeSessionState)}</code>
                </pre>
              </div>

              <div className="flex min-w-0 flex-col gap-3">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Persisted data</p>
                <pre className="max-h-[22rem] w-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-[1.25rem] bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                  <code>{formatJson(domainData)}</code>
                </pre>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
