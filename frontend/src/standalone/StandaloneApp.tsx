import { startTransition, useState } from 'react';
import { Renderer } from '@openuidev/react-lang';
import { RotateCcw } from 'lucide-react';
import { ErrorBoundary } from 'react-error-boundary';
import { Badge } from '@components/ui/badge';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { createDomainToolProvider } from '@features/builder/openui/runtime/createDomainToolProvider';
import { handleOpenUiActionEvent } from '@features/builder/openui/runtime/actionEvents';
import { mapOpenUiErrorsToIssues, mapParseResultToIssues } from '@features/builder/openui/runtime/issues';
import { builderOpenUiLibrary } from '@features/builder/openui/library';
import { validateOpenUiSource } from '@features/builder/openui/runtime/validation';
import { clearStandaloneStoredState, restoreStandaloneState, writeStandaloneStoredState } from '@features/builder/standalone/storage';
import {
  normalizeStandaloneDomainData,
  normalizeStandaloneRuntimeState,
  parseStandalonePayload,
  type KittoStandalonePayload,
} from '@features/builder/standalone/types';
import type { BuilderParseIssue } from '@features/builder/types';

type StandaloneAppProps = {
  payload?: KittoStandalonePayload;
};

type StandaloneFallbackProps = {
  details?: BuilderParseIssue[];
  error?: unknown;
  onResetLocalData?: () => void;
  title: string;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return 'Unknown runtime error.';
}

function StandaloneFallback({ details, error, onResetLocalData, title }: StandaloneFallbackProps) {
  const errorMessage = error ? getErrorMessage(error) : null;

  return (
    <div className="flex min-h-full items-center justify-center p-5 sm:p-6">
      <Card className="w-full max-w-2xl border-rose-200/80 bg-white/96">
        <CardHeader className="border-b border-rose-100/80 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-xl">{title}</CardTitle>
            <Badge variant="danger">Standalone app error</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm leading-6 text-slate-600">
            This standalone HTML file could not render the exported app. If local saved data is causing the issue, reset the
            exported app back to its embedded baseline state.
          </p>

          {errorMessage ? (
            <div className="rounded-[1.25rem] bg-rose-50/80 px-4 py-3 text-sm leading-6 break-words text-rose-700">
              {errorMessage}
            </div>
          ) : null}

          {details?.length ? (
            <div className="space-y-2">
              {details.map((issue, index) => (
                <div
                  key={`${issue.code}-${issue.statementId ?? 'global'}-${index}`}
                  className="rounded-[1.25rem] border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-700"
                >
                  <strong className="text-slate-950">{issue.code}</strong>
                  {issue.statementId ? ` in ${issue.statementId}` : null}
                  : {issue.message}
                </div>
              ))}
            </div>
          ) : null}

          {onResetLocalData ? (
            <div className="flex justify-end">
              <Button type="button" size="sm" variant="secondary" onClick={onResetLocalData}>
                <RotateCcw className="h-4 w-4" />
                Reset local data
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function StandaloneIssuePanel({ issues }: { issues: BuilderParseIssue[] }) {
  if (issues.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-[1.5rem] border border-rose-200 bg-rose-50/80 p-4">
      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-rose-700">Standalone runtime issues</p>
      <div className="mt-3 space-y-2">
        {issues.map((issue, index) => (
          <div
            key={`${issue.code}-${issue.statementId ?? 'global'}-${index}`}
            className="rounded-2xl bg-white px-3 py-2 text-sm break-words text-slate-700"
          >
            <strong className="text-slate-900">{issue.code}</strong>
            {issue.statementId ? ` in ${issue.statementId}` : null}
            : {issue.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export function StandaloneApp({ payload }: StandaloneAppProps) {
  const parsedPayload = parseStandalonePayload(payload);
  const [restoredState] = useState(() =>
    parsedPayload
      ? restoreStandaloneState(parsedPayload.storageKey, parsedPayload.initialRuntimeState, parsedPayload.initialDomainData)
      : {
          runtimeState: {},
          domainData: {},
          restoredFromStorage: false,
        },
  );
  const [runtimeState, setRuntimeState] = useState<Record<string, unknown>>(restoredState.runtimeState);
  const [domainData, setDomainData] = useState<Record<string, unknown>>(restoredState.domainData);
  const [parseIssues, setParseIssues] = useState<BuilderParseIssue[]>([]);
  const [runtimeIssues, setRuntimeIssues] = useState<BuilderParseIssue[]>([]);
  const [resetVersion, setResetVersion] = useState(0);

  function persistStandaloneState(nextRuntimeState: Record<string, unknown>, nextDomainData: Record<string, unknown>) {
    if (!parsedPayload) {
      return;
    }

    writeStandaloneStoredState(parsedPayload.storageKey, nextRuntimeState, nextDomainData);
  }

  function replaceStandaloneDomainData(nextDomainData: Record<string, unknown>) {
    const safeDomainData = normalizeStandaloneDomainData(nextDomainData);

    setDomainData(safeDomainData);
    persistStandaloneState(runtimeState, safeDomainData);
  }

  function handleRuntimeStateUpdate(nextRuntimeState: Record<string, unknown>) {
    const safeRuntimeState = normalizeStandaloneRuntimeState(nextRuntimeState);

    setRuntimeState(safeRuntimeState);
    persistStandaloneState(safeRuntimeState, domainData);
  }

  function handleResetLocalData() {
    if (!parsedPayload) {
      return;
    }

    clearStandaloneStoredState(parsedPayload.storageKey);
    const baselineRuntimeState = normalizeStandaloneRuntimeState(parsedPayload.initialRuntimeState);
    const baselineDomainData = normalizeStandaloneDomainData(parsedPayload.initialDomainData);

    startTransition(() => {
      setParseIssues([]);
      setRuntimeIssues([]);
      setRuntimeState(baselineRuntimeState);
      setDomainData(baselineDomainData);
      setResetVersion((currentValue) => currentValue + 1);
    });
  }

  if (!parsedPayload) {
    return <StandaloneFallback title="Unable to open standalone app" />;
  }

  const sourceValidation = validateOpenUiSource(parsedPayload.source);
  const standaloneToolProvider = createDomainToolProvider({
    readDomainData: () => domainData,
    replaceDomainData: replaceStandaloneDomainData,
  });

  if (!sourceValidation.isValid) {
    return (
      <StandaloneFallback
        details={sourceValidation.issues}
        onResetLocalData={handleResetLocalData}
        title={parsedPayload.title || 'Unable to open standalone app'}
      />
    );
  }

  const combinedIssues = [...parseIssues, ...runtimeIssues];

  return (
    <div className="min-h-full bg-[#f7f5ef] text-slate-900">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-5 sm:px-6">
        <div className="min-h-0 flex-1">
          <ErrorBoundary
            fallbackRender={({ error, resetErrorBoundary }) => (
              <StandaloneFallback
                error={error}
                onResetLocalData={() => {
                  handleResetLocalData();
                  resetErrorBoundary();
                }}
                title={parsedPayload.title || 'Standalone app crashed'}
              />
            )}
            resetKeys={[parsedPayload.appId, resetVersion]}
          >
            <div className="min-h-full overflow-y-auto rounded-[1.75rem] bg-transparent p-1 sm:p-2">
              <Renderer
                key={`${parsedPayload.appId}:${resetVersion}`}
                initialState={runtimeState}
                library={builderOpenUiLibrary}
                onAction={handleOpenUiActionEvent}
                onError={(errors) => {
                  setRuntimeIssues(mapOpenUiErrorsToIssues(errors));
                }}
                onParseResult={(result) => {
                  setParseIssues(mapParseResultToIssues(result));
                }}
                onStateUpdate={(nextRuntimeState) => {
                  handleRuntimeStateUpdate(nextRuntimeState as Record<string, unknown>);
                }}
                queryLoader={<Badge variant="muted">Loading query…</Badge>}
                response={parsedPayload.source}
                toolProvider={standaloneToolProvider}
              />
            </div>
          </ErrorBoundary>
        </div>

        <StandaloneIssuePanel issues={combinedIssues} />

        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 rounded-lg border border-slate-200 px-3 text-xs shadow-none"
            onClick={handleResetLocalData}
          >
            <RotateCcw className="h-4 w-4" />
            Reset local data
          </Button>
        </div>
      </div>
    </div>
  );
}
