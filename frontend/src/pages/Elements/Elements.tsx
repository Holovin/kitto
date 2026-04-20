import { useRef, useState } from 'react';
import { Renderer } from '@openuidev/react-lang';
import { RotateCcw } from 'lucide-react';
import { ErrorBoundary } from 'react-error-boundary';
import { Badge } from '@components/ui/badge';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { builderOpenUiLibrary, getBuilderOpenUiSpec } from '@features/builder/openui/library';
import { handleOpenUiActionEvent } from '@features/builder/openui/runtime/actionEvents';
import { createDomainToolProvider } from '@features/builder/openui/runtime/createDomainToolProvider';
import { createRendererCrashIssue, mapOpenUiErrorsToIssues, mapParseResultToIssues } from '@features/builder/openui/runtime/issues';
import { OPENUI_SUPPORTED_COMPONENTS } from '@features/builder/openui/runtime/prompt';
import { OPENUI_ACTION_DEFINITIONS } from '@features/builder/openui/runtime/actionCatalog';
import type { BuilderParseIssue } from '@features/builder/types';
import { ELEMENT_DEMO_DEFINITIONS } from './elementDemos';

type ComponentSchema = {
  properties?: Record<string, unknown>;
  required?: string[];
};

type ActionSchemaViewMode = 'demo' | 'spec';
type SchemaViewMode = 'demo' | 'openui' | 'json';

type ElementSandboxProps = {
  componentName: string;
  source: string;
  initialDomainData?: Record<string, unknown>;
  initialRuntimeState?: Record<string, unknown>;
};

type ScopedRuntimeIssues = {
  issues: BuilderParseIssue[];
  scope: string;
};

const librarySchema = builderOpenUiLibrary.toJSONSchema();
const librarySpec = getBuilderOpenUiSpec();
const groupByComponent = new Map(
  (builderOpenUiLibrary.componentGroups ?? []).flatMap((group) => group.components.map((componentName) => [componentName, group.name] as const)),
);

function cloneRecord(value?: Record<string, unknown>) {
  return structuredClone(value ?? {});
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function getComponentSchema(componentName: string): ComponentSchema {
  return (librarySchema.$defs?.[componentName] as ComponentSchema | undefined) ?? {};
}

function getOpenUiSchema(componentName: string, schema: ComponentSchema) {
  const spec = librarySpec.components[componentName];
  const required = new Set(schema.required ?? []);
  const propertyLines = Object.entries(schema.properties ?? {}).map(([name, property]) => {
    const description =
      property && typeof property === 'object' && 'description' in property && typeof property.description === 'string'
        ? property.description
        : '';

    return `// ${required.has(name) ? name : `${name}?`}: ${description || 'No description.'}`;
  });

  return [spec?.signature ?? `${componentName}()`, spec?.description ? `// ${spec.description}` : null, ...propertyLines].filter(Boolean).join('\n');
}

function mergeRuntimeDefaults(
  stateDeclarations: Record<string, unknown> | undefined,
  initialRuntimeState: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...cloneRecord(stateDeclarations),
    ...cloneRecord(initialRuntimeState),
  };
}

function ElementSchemaPanel({
  componentName,
  demoSource,
  schema,
}: {
  componentName: string;
  demoSource: string;
  schema: ComponentSchema;
}) {
  const [viewMode, setViewMode] = useState<SchemaViewMode>('openui');

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Schema</p>
        <div className="flex items-center gap-2">
          <Button
            className="h-7 rounded-lg px-2.5 text-xs shadow-none"
            size="sm"
            variant={viewMode === 'demo' ? 'default' : 'secondary'}
            onClick={() => setViewMode('demo')}
          >
            Demo
          </Button>
          <Button
            className="h-7 rounded-lg px-2.5 text-xs shadow-none"
            size="sm"
            variant={viewMode === 'openui' ? 'default' : 'secondary'}
            onClick={() => setViewMode('openui')}
          >
            OpenUI
          </Button>
          <Button
            className="h-7 rounded-lg px-2.5 text-xs shadow-none"
            size="sm"
            variant={viewMode === 'json' ? 'default' : 'secondary'}
            onClick={() => setViewMode('json')}
          >
            JSON
          </Button>
        </div>
      </div>

      <pre className="w-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-[1.25rem] bg-slate-950 p-4 text-xs leading-6 text-slate-100">
        <code>{viewMode === 'demo' ? demoSource : viewMode === 'openui' ? getOpenUiSchema(componentName, schema) : formatJson(schema)}</code>
      </pre>
    </div>
  );
}

function ActionSectionHeading({ children }: { children: string }) {
  return <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-slate-500">{children}</p>;
}

function ActionSchemaPanel({
  demoExample,
  inputSchema,
}: {
  demoExample: string;
  inputSchema: Record<string, unknown>;
}) {
  const [viewMode, setViewMode] = useState<ActionSchemaViewMode>('spec');

  return (
    <div className="min-w-0">
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-3">
        <ActionSectionHeading>Input schema</ActionSectionHeading>
        <div className="flex items-center gap-2">
          <Button
            className="h-7 rounded-lg px-2.5 text-xs shadow-none"
            size="sm"
            variant={viewMode === 'spec' ? 'default' : 'secondary'}
            onClick={() => setViewMode('spec')}
          >
            Spec
          </Button>
          <Button
            className="h-7 rounded-lg px-2.5 text-xs shadow-none"
            size="sm"
            variant={viewMode === 'demo' ? 'default' : 'secondary'}
            onClick={() => setViewMode('demo')}
          >
            Demo
          </Button>
        </div>
      </div>
      <div className="mt-3 overflow-hidden rounded-[1.25rem] bg-slate-950">
        <pre className="w-full max-w-full overflow-auto whitespace-pre-wrap break-words p-4 text-xs leading-6 text-slate-100">
          <code>{viewMode === 'spec' ? formatJson(inputSchema) : demoExample}</code>
        </pre>
      </div>
    </div>
  );
}

function ActionDocumentationPanel({
  returns,
  summary,
  useWhen,
}: {
  returns: string;
  summary: string;
  useWhen: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-h-7 items-center">
        <ActionSectionHeading>Documentation</ActionSectionHeading>
      </div>
      <div className="mt-3 rounded-[1.25rem] border border-slate-200 bg-white p-4 text-slate-700">
        <div className="space-y-4 text-sm leading-6">
          <div>
            <p className="font-semibold text-slate-950">What it does</p>
            <p className="mt-1 text-slate-600">{summary}</p>
          </div>
          <div>
            <p className="font-semibold text-slate-950">Use when</p>
            <p className="mt-1 text-slate-600">{useWhen}</p>
          </div>
          <div>
            <p className="font-semibold text-slate-950">Returns</p>
            <p className="mt-1 text-slate-600">{returns}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ElementSandbox({ componentName, source, initialDomainData, initialRuntimeState }: ElementSandboxProps) {
  const [initialDomainDataSnapshot] = useState<Record<string, unknown>>(() => cloneRecord(initialDomainData));
  const [initialRuntimeStateSnapshot] = useState<Record<string, unknown>>(() => cloneRecord(initialRuntimeState));
  const [domainData, setDomainData] = useState<Record<string, unknown>>(initialDomainDataSnapshot);
  const [runtimeState, setRuntimeState] = useState<Record<string, unknown>>(initialRuntimeStateSnapshot);
  const [parseIssues, setParseIssues] = useState<BuilderParseIssue[]>([]);
  const [scopedRuntimeIssues, setScopedRuntimeIssues] = useState<ScopedRuntimeIssues>({
    issues: [],
    scope: '',
  });
  const [resetVersion, setResetVersion] = useState(0);
  const stateDeclarationDefaultsRef = useRef<Record<string, unknown>>({});
  const hasHydratedInitialRuntimeStateRef = useRef(false);
  const runtimeIssueScope = `${componentName}:${source}:${resetVersion}`;
  const runtimeIssues = scopedRuntimeIssues.scope === runtimeIssueScope ? scopedRuntimeIssues.issues : [];
  const toolProvider = createDomainToolProvider({
    readDomainData: () => domainData,
    replaceDomainData: (nextData) => {
      setDomainData(nextData);
    },
  });

  const allIssues = [...parseIssues, ...runtimeIssues];

  function handleReset() {
    setParseIssues([]);
    hasHydratedInitialRuntimeStateRef.current = false;
    setRuntimeState(mergeRuntimeDefaults(stateDeclarationDefaultsRef.current, initialRuntimeStateSnapshot));
    setDomainData(cloneRecord(initialDomainDataSnapshot));
    setResetVersion((currentValue) => currentValue + 1);
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="min-w-0 rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Badge variant={allIssues.length > 0 ? 'danger' : 'success'}>{allIssues.length > 0 ? `${allIssues.length} issue(s)` : 'Ready'}</Badge>
          <Button className="h-8 rounded-lg border border-slate-200 px-3 text-xs shadow-none" size="sm" variant="secondary" onClick={handleReset}>
            <RotateCcw className="h-4 w-4" />
            Reset demo
          </Button>
        </div>

        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="min-h-[16rem]">
              <ErrorBoundary
                fallbackRender={({ resetErrorBoundary }) => (
                  <div className="rounded-[1.25rem] border border-rose-200 bg-rose-50/80 p-4" role="alert">
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-rose-700">Sandbox runtime error</p>
                    <p className="mt-3 text-sm leading-6 text-slate-700">
                      This demo crashed while rendering. Reset the sandbox to retry with the committed demo source.
                    </p>
                    <div className="mt-4">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          handleReset();
                          resetErrorBoundary();
                        }}
                      >
                        Reset demo
                      </Button>
                    </div>
                  </div>
                )}
                onError={(error) => {
                  setScopedRuntimeIssues({
                    issues: [createRendererCrashIssue(error, 'sandbox-runtime-error', 'The element sandbox crashed while rendering.')],
                    scope: runtimeIssueScope,
                  });
                }}
                resetKeys={[source, resetVersion]}
              >
                <Renderer
                  key={`${componentName}-${resetVersion}`}
                  initialState={runtimeState}
                  library={builderOpenUiLibrary}
                  onAction={handleOpenUiActionEvent}
                  onError={(errors) =>
                    setScopedRuntimeIssues({
                      issues: mapOpenUiErrorsToIssues(errors),
                      scope: runtimeIssueScope,
                    })
                  }
                  onParseResult={(result) => {
                    setParseIssues(mapParseResultToIssues(result));
                    stateDeclarationDefaultsRef.current =
                      result?.stateDeclarations && typeof result.stateDeclarations === 'object'
                        ? cloneRecord(result.stateDeclarations as Record<string, unknown>)
                        : {};

                    if (!hasHydratedInitialRuntimeStateRef.current) {
                      hasHydratedInitialRuntimeStateRef.current = true;
                      setRuntimeState(mergeRuntimeDefaults(stateDeclarationDefaultsRef.current, initialRuntimeStateSnapshot));
                    }
                  }}
                  onStateUpdate={(state) => {
                    hasHydratedInitialRuntimeStateRef.current = true;
                    setRuntimeState(state as Record<string, unknown>);
                  }}
                  queryLoader={<Badge variant="muted">Loading query…</Badge>}
                  response={source}
                  toolProvider={toolProvider}
                />
              </ErrorBoundary>
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            <div className="flex min-w-0 flex-col gap-3">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Reactive state</p>
              <pre className="max-h-[22rem] w-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-[1.25rem] bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                <code>{formatJson(runtimeState)}</code>
              </pre>
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Persisted data</p>
              <pre className="max-h-[22rem] w-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-[1.25rem] bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                <code>{formatJson(domainData)}</code>
              </pre>
            </div>

            {allIssues.length > 0 ? (
              <div className="min-w-0 rounded-[1.25rem] border border-rose-200 bg-rose-50/80 p-4">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-rose-700">Sandbox issues</p>
                <div className="mt-3 space-y-2">
                  {allIssues.map((issue, index) => (
                    <div
                      key={`${issue.code}-${issue.statementId ?? 'global'}-${index}`}
                      className="break-words rounded-2xl bg-white px-3 py-2 text-sm text-slate-700"
                    >
                      <strong className="text-slate-900">{issue.code}</strong>
                      {issue.statementId ? ` in ${issue.statementId}` : null}
                      : {issue.message}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ElementsPage() {
  return (
    <section className="w-full min-w-0 space-y-6">
      <Card className="min-w-0 border-white/70 bg-white/92">
        <CardHeader className="border-b border-slate-200/70 pb-4">
          <CardTitle className="text-2xl">Elements</CardTitle>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4 pt-6">
          {OPENUI_SUPPORTED_COMPONENTS.map((componentName) => {
            const schema = getComponentSchema(componentName);
            const groupName = groupByComponent.get(componentName) ?? 'Components';
            const demoDefinition = ELEMENT_DEMO_DEFINITIONS[componentName];

            return (
              <Card key={componentName} className="min-w-0 overflow-hidden border-slate-200/80 bg-slate-50/70 shadow-none">
                <CardHeader className="border-b border-slate-200/70 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <CardTitle className="break-words text-lg">{componentName}</CardTitle>
                    <Badge variant="muted">{groupName}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="min-w-0 space-y-5 pt-6">
                  {demoDefinition ? (
                    <ElementSandbox
                      componentName={componentName}
                      initialDomainData={demoDefinition.initialDomainData}
                      initialRuntimeState={demoDefinition.initialRuntimeState}
                      source={demoDefinition.source}
                    />
                  ) : (
                    <div className="rounded-[1.25rem] border border-dashed border-slate-200 bg-white/80 p-4 text-sm text-slate-500">
                      Demo is not configured yet.
                    </div>
                  )}

                  <ElementSchemaPanel componentName={componentName} demoSource={demoDefinition?.source ?? ''} schema={schema} />
                </CardContent>
              </Card>
            );
          })}
        </CardContent>
      </Card>

      <Card className="min-w-0 border-white/70 bg-white/92">
        <CardHeader className="border-b border-slate-200/70 pb-4">
          <CardTitle className="text-2xl">Actions</CardTitle>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4 pt-6">
          {OPENUI_ACTION_DEFINITIONS.map((action) => (
            <Card key={action.name} className="min-w-0 overflow-hidden border-slate-200/80 bg-slate-50/70 shadow-none">
              <CardHeader className="border-b border-slate-200/70 pb-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <CardTitle className="break-words text-lg">{action.signature}</CardTitle>
                  <p className="text-sm font-medium text-slate-500">{action.shortDescription}</p>
                </div>
              </CardHeader>
              <CardContent className="grid min-w-0 gap-4 pt-6 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.92fr)]">
                <ActionSchemaPanel demoExample={action.demoExample} inputSchema={action.inputSchema} />
                <ActionDocumentationPanel
                  returns={action.documentation.returns}
                  summary={action.documentation.summary}
                  useWhen={action.documentation.useWhen}
                />
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
