import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { Renderer } from '@openuidev/react-lang';
import { LoaderCircle, RotateCcw } from 'lucide-react';
import { ErrorBoundary } from 'react-error-boundary';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardTitle } from '@components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs';
import { DefinitionPanel } from '@features/builder/components/DefinitionPanel';
import { PreviewEmptyState } from '@features/builder/components/PreviewEmptyState';
import { PreviewErrorFallback } from '@features/builder/components/PreviewErrorFallback';
import { builderOpenUiLibrary } from '@features/builder/openui/library';
import { handleOpenUiActionEvent } from '@features/builder/openui/runtime/actionEvents';
import {
  combinePreviewIssues,
  createRendererCrashIssue,
  mapOpenUiErrorsToIssues,
  mapParseResultToIssues,
  shouldResetRuntimeIssues,
} from '@features/builder/openui/runtime/issues';
import { builderToolProvider } from '@features/builder/openui/runtime/toolProvider';
import {
  selectActiveTab,
  selectDefinitionSource,
  selectDomainData,
  selectHasRejectedDefinition,
  selectHistory,
  selectIsStreaming,
  selectParseIssues,
  selectPreviewSource,
  selectRuntimeSessionState,
} from '@features/builder/store/selectors';
import { builderActions } from '@features/builder/store/builderSlice';
import { builderSessionActions } from '@features/builder/store/builderSessionSlice';
import { domainActions } from '@features/builder/store/domainSlice';
import type { BuilderParseIssue, BuilderTabId } from '@features/builder/types';
import { useAppDispatch, useAppSelector } from '@store/hooks';

type ScopedRuntimeIssues = {
  issues: BuilderParseIssue[];
  scope: string;
};

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function PreviewTabs() {
  const dispatch = useAppDispatch();
  const activeTab = useAppSelector(selectActiveTab);
  const definitionSource = useAppSelector(selectDefinitionSource);
  const domainData = useAppSelector(selectDomainData);
  const history = useAppSelector(selectHistory);
  const isShowingRejectedDefinition = useAppSelector(selectHasRejectedDefinition);
  const isStreaming = useAppSelector(selectIsStreaming);
  const parseIssues = useAppSelector(selectParseIssues);
  const previewSource = useAppSelector(selectPreviewSource);
  const runtimeSessionState = useAppSelector(selectRuntimeSessionState);
  const [scopedRuntimeIssues, setScopedRuntimeIssues] = useState<ScopedRuntimeIssues>({
    issues: [],
    scope: '',
  });
  const [rendererResetVersion, setRendererResetVersion] = useState(0);
  const deferredPreviewSource = useDeferredValue(previewSource);
  const currentSnapshot = history.at(-1);
  const isPreviewSynchronized = deferredPreviewSource === previewSource;
  const isPreviewEmptyCanvas = !previewSource.trim();
  const isEmptyCanvas = isPreviewEmptyCanvas && !isShowingRejectedDefinition;
  const resolvedActiveTab = isEmptyCanvas && activeTab !== 'preview' ? 'preview' : activeTab;
  const runtimeIssueScope = `${history.length}:${currentSnapshot?.committedAt ?? ''}:${previewSource}:${isShowingRejectedDefinition ? 'rejected' : 'preview'}:${rendererResetVersion}`;
  const runtimeIssues = scopedRuntimeIssues.scope === runtimeIssueScope ? scopedRuntimeIssues.issues : [];
  const combinedIssues = combinePreviewIssues({
    isPreviewEmptyCanvas,
    isShowingRejectedDefinition,
    parseIssues,
    runtimeIssues,
  });
  const previewOverlayLabel = isPreviewEmptyCanvas ? 'Generating...' : 'Updating...';
  const previousPreviewRef = useRef<{
    isShowingRejectedDefinition: boolean;
    previewSource: string;
  } | null>(null);

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

  function handleResetAppState() {
    if (!currentSnapshot || isStreaming) {
      return;
    }

    dispatch(domainActions.replaceData(structuredClone(currentSnapshot.initialDomainData)));
    dispatch(builderSessionActions.replaceRuntimeSessionState(structuredClone(currentSnapshot.initialRuntimeState)));
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
      className="flex h-full min-h-0 flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="max-w-full text-2xl leading-tight break-words sm:text-3xl">Preview</CardTitle>
        <TabsList>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="definition" disabled={isEmptyCanvas}>
            Definition
          </TabsTrigger>
          <TabsTrigger value="app-state" disabled={isPreviewEmptyCanvas}>
            App State
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="preview" className="mt-0 flex-1 min-h-0">
        <Card className="h-full min-h-0 overflow-hidden border-0 bg-white/92">
          <CardContent className="h-full min-h-0 p-6">
            <div className="relative h-full min-h-0" aria-busy={isStreaming}>
              {isPreviewEmptyCanvas ? (
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
                    resetKeys={[deferredPreviewSource, rendererResetVersion]}
                  >
                    <Renderer
                      key={`${history.length}:${currentSnapshot?.source ?? ''}:${rendererResetVersion}`}
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
                      onStateUpdate={(state) => {
                        const nextState = state as Record<string, unknown>;
                        dispatch(builderSessionActions.replaceRuntimeSessionState(nextState));
                      }}
                      queryLoader={
                        <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                          Loading query...
                        </div>
                      }
                      response={deferredPreviewSource}
                      toolProvider={builderToolProvider}
                    />
                  </ErrorBoundary>
                </div>
              )}

              {isStreaming ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[1.75rem] bg-white/60 backdrop-blur-[1px]">
                  <div
                    aria-live="polite"
                    className="flex items-center gap-3 rounded-full border border-slate-200/80 bg-white/90 px-4 py-3 text-slate-900 shadow-lg"
                    role="status"
                  >
                    <LoaderCircle className="h-7 w-7 animate-spin" />
                    <span className="text-sm font-medium">{previewOverlayLabel}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="definition" className="mt-0 flex-1 min-h-0">
        <DefinitionPanel issues={combinedIssues} source={definitionSource} />
      </TabsContent>

      <TabsContent value="app-state" className="mt-0 flex-1 min-h-0">
        <Card className="h-full min-h-0 overflow-hidden border-white/70 bg-white/92">
          <CardContent className="flex h-full min-h-0 flex-col gap-4 p-6">
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button
                className="h-8 rounded-lg border border-slate-200 px-3 text-xs shadow-none"
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
