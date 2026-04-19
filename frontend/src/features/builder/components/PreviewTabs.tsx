import { useDeferredValue, useEffect, useState } from 'react';
import { Renderer } from '@openuidev/react-lang';
import { LoaderCircle, RotateCcw } from 'lucide-react';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardTitle } from '@components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs';
import { DefinitionPanel } from '@features/builder/components/DefinitionPanel';
import { PreviewEmptyState } from '@features/builder/components/PreviewEmptyState';
import { builderOpenUiLibrary } from '@features/builder/openui/library';
import { handleOpenUiActionEvent } from '@features/builder/openui/runtime/actionEvents';
import { mapOpenUiErrorsToIssues, mapParseResultToIssues } from '@features/builder/openui/runtime/issues';
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
  const [runtimeIssues, setRuntimeIssues] = useState<BuilderParseIssue[]>([]);
  const [rendererResetVersion, setRendererResetVersion] = useState(0);
  const deferredPreviewSource = useDeferredValue(previewSource);
  const currentSnapshot = history.at(-1);
  const isPreviewEmptyCanvas = !previewSource.trim();
  const resolvedActiveTab = isPreviewEmptyCanvas && activeTab !== 'preview' ? 'preview' : activeTab;
  const combinedIssues = isPreviewEmptyCanvas || isShowingRejectedDefinition ? parseIssues : [...parseIssues, ...runtimeIssues];

  useEffect(() => {
    if (!isPreviewEmptyCanvas || activeTab === 'preview') {
      return;
    }

    dispatch(builderActions.setActiveTab('preview'));
  }, [activeTab, dispatch, isPreviewEmptyCanvas]);

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
        if (isPreviewEmptyCanvas && value !== 'preview') {
          return;
        }

        dispatch(builderActions.setActiveTab(value as BuilderTabId));
      }}
      className="flex h-full min-h-0 flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="max-w-full text-2xl leading-tight break-words sm:text-3xl">Preview, definition, and state</CardTitle>
        <TabsList>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="definition" disabled={isPreviewEmptyCanvas}>
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
            {isPreviewEmptyCanvas ? (
              <div className="h-full min-h-0 overflow-y-auto rounded-[1.75rem] border border-slate-200/80 bg-slate-50/70 p-4 sm:p-6">
                <PreviewEmptyState />
              </div>
            ) : (
              <div className="h-full min-h-0 overflow-y-auto p-4 sm:p-5">
                <Renderer
                  key={`${history.length}:${currentSnapshot?.source ?? ''}:${rendererResetVersion}`}
                  initialState={runtimeSessionState}
                  isStreaming={isStreaming}
                  library={builderOpenUiLibrary}
                  onAction={handleOpenUiActionEvent}
                  onError={(errors) => setRuntimeIssues(mapOpenUiErrorsToIssues(errors))}
                  onParseResult={(result) => {
                    if (isShowingRejectedDefinition) {
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
              </div>
            )}
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
