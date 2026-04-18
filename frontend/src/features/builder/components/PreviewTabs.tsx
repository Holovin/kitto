import { useDeferredValue, useState } from 'react';
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
import { OpenUiNavigationProvider } from '@features/builder/openui/runtime/OpenUiNavigationProvider';
import { builderToolProvider } from '@features/builder/openui/runtime/toolProvider';
import {
  selectActiveTab,
  selectCommittedSource,
  selectCurrentScreenId,
  selectHistory,
  selectIsStreaming,
  selectParseIssues,
  selectRuntimeSessionState,
  selectStreamedSource,
} from '@features/builder/store/selectors';
import { builderActions } from '@features/builder/store/builderSlice';
import { builderSessionActions } from '@features/builder/store/builderSessionSlice';
import { domainActions } from '@features/builder/store/domainSlice';
import type { BuilderParseIssue, BuilderTabId } from '@features/builder/types';
import { useAppDispatch, useAppSelector } from '@store/hooks';

export function PreviewTabs() {
  const dispatch = useAppDispatch();
  const activeTab = useAppSelector(selectActiveTab);
  const committedSource = useAppSelector(selectCommittedSource);
  const currentScreenId = useAppSelector(selectCurrentScreenId);
  const history = useAppSelector(selectHistory);
  const isStreaming = useAppSelector(selectIsStreaming);
  const parseIssues = useAppSelector(selectParseIssues);
  const runtimeSessionState = useAppSelector(selectRuntimeSessionState);
  const streamedSource = useAppSelector(selectStreamedSource);
  const [runtimeIssues, setRuntimeIssues] = useState<BuilderParseIssue[]>([]);
  const [rendererResetVersion, setRendererResetVersion] = useState(0);
  const source = isStreaming ? streamedSource : committedSource;
  const deferredSource = useDeferredValue(source);
  const currentSnapshot = history.at(-1);
  const isEmptyCanvas = !source.trim();
  const combinedIssues = isEmptyCanvas ? parseIssues : [...parseIssues, ...runtimeIssues];

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
      value={activeTab}
      onValueChange={(value: string) => dispatch(builderActions.setActiveTab(value as BuilderTabId))}
      className="flex h-full min-h-0 flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="max-w-full text-2xl leading-tight break-words sm:text-3xl">Preview and definition</CardTitle>
        <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
          <Button
            className="h-7 rounded-lg border border-slate-200 px-2 text-xs shadow-none"
            disabled={!currentSnapshot || isEmptyCanvas || isStreaming}
            size="sm"
            variant="ghost"
            onClick={handleResetAppState}
          >
            <RotateCcw className="h-4 w-4" />
            Reset app state
          </Button>
          <TabsList>
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="definition">Definition</TabsTrigger>
          </TabsList>
        </div>
      </div>

      <TabsContent value="preview" className="mt-0 flex-1 min-h-0">
        <Card className="h-full min-h-0 overflow-hidden border-white/70 bg-white/92">
          <CardContent className="h-full min-h-0 p-6">
            {isEmptyCanvas && !isStreaming ? (
              <div className="h-full min-h-0 overflow-y-auto rounded-[1.75rem] border border-slate-200/80 bg-slate-50/70 p-4 sm:p-6">
                <PreviewEmptyState />
              </div>
            ) : (
              <div className="h-full min-h-0 overflow-y-auto">
                <OpenUiNavigationProvider currentScreenId={currentScreenId}>
                  <Renderer
                    key={`${history.length}:${currentSnapshot?.source ?? ''}:${rendererResetVersion}`}
                    initialState={runtimeSessionState}
                    isStreaming={isStreaming}
                    library={builderOpenUiLibrary}
                    onAction={handleOpenUiActionEvent}
                    onError={(errors) => setRuntimeIssues(mapOpenUiErrorsToIssues(errors))}
                    onParseResult={(result) => dispatch(builderActions.setParseIssues(mapParseResultToIssues(result)))}
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
                    response={deferredSource}
                    toolProvider={builderToolProvider}
                  />
                </OpenUiNavigationProvider>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="definition" className="mt-0 flex-1 min-h-0">
        <DefinitionPanel issues={combinedIssues} source={source} />
      </TabsContent>
    </Tabs>
  );
}
