import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Renderer } from '@openuidev/react-lang';
import { ArrowUp, RotateCcw } from 'lucide-react';
import { ErrorBoundary } from 'react-error-boundary';
import { useGetPromptsInfoQuery } from '@api/apiSlice';
import { Badge } from '@components/ui/badge';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs';
import { builderOpenUiLibrary, getBuilderOpenUiSpec } from '@features/builder/openui/library';
import { handleOpenUiActionEvent } from '@features/builder/openui/runtime/actionEvents';
import { createDomainToolProvider } from '@features/builder/openui/runtime/createDomainToolProvider';
import { createRendererCrashIssue, mapOpenUiErrorsToIssues, mapParseResultToIssues } from '@features/builder/openui/runtime/issues';
import { OPENUI_ACTION_DEFINITIONS } from '@features/builder/openui/runtime/actionCatalog';
import type { BuilderParseIssue, PromptInfoToolSpec, PromptsInfoResponse } from '@features/builder/types';
import { ELEMENT_DEMO_DEFINITIONS } from './elementDemos';
import {
  ACTION_REFERENCE_GROUPS,
  ACTION_REFERENCE_ITEMS,
  ELEMENT_REFERENCE_GROUPS,
  ELEMENT_REFERENCE_ITEMS,
  PROMPT_REFERENCE_GROUPS,
  PROMPT_REFERENCE_ITEMS,
  type PromptReferenceSectionLabel,
  type ReferenceGroup,
  resolveReferenceTargetFromHash,
  type ReferenceTabId,
} from './referenceNavigation';

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
const elementReferenceIdByName = new Map(ELEMENT_REFERENCE_ITEMS.map(({ id, label }) => [label, id] as const));
const actionReferenceIdByName = new Map(ACTION_REFERENCE_ITEMS.map(({ id, label }) => [label, id] as const));
const promptReferenceIdByName = new Map(PROMPT_REFERENCE_ITEMS.map(({ id, label }) => [label, id] as const));
const actionDefinitionByName = new Map(OPENUI_ACTION_DEFINITIONS.map((action) => [action.name, action] as const));

type PromptReferenceSectionDefinition = {
  description: string | ((data: PromptsInfoResponse) => string);
  formatBody: (data: PromptsInfoResponse) => string;
  title: PromptReferenceSectionLabel;
};

const PROMPT_REFERENCE_SECTIONS: PromptReferenceSectionDefinition[] = [
  {
    title: 'Backend config',
    description:
      'Current backend prompt configuration for the main initial generation call, including the active temperature used for generation and echoed back in generation responses.',
    formatBody: (data) =>
      [
        `model: ${data.config.model}`,
        `temperature: ${data.config.temperature}`,
        `maxOutputTokens: ${data.config.maxOutputTokens}`,
        `requestMaxBytes: ${data.config.requestMaxBytes}`,
        `outputMaxBytes: ${data.config.outputMaxBytes}`,
        `cacheKeyPrefix: ${data.config.cacheKeyPrefix}`,
      ].join('\n'),
  },
  {
    title: 'System prompt',
    description:
      'Exact system prompt text currently sent to the model, together with the hash logged in prompt I/O telemetry.',
    formatBody: (data) => [`systemPromptHash: ${data.systemPrompt.hash}`, '', data.systemPrompt.text].join('\n'),
  },
  {
    title: 'User prompt template',
    description:
      'Readable outline of the initial model input: stable system prompt, optional earlier turns for context, and the final user turn that defines the task.',
    formatBody: (data) => data.requestPromptTemplate,
  },
  {
    title: 'Tool specs',
    description: 'Human-readable tool list derived from the backend tool specs, without expanding full JSON schemas.',
    formatBody: (data) =>
      data.toolSpecs
        .map((toolSpec: PromptInfoToolSpec) => [`${toolSpec.signature}`, toolSpec.description].join('\n'))
        .join('\n\n'),
  },
  {
    title: 'Repair prompt',
    description: (data) =>
      `Repair-message template used as the baseline shape when the first draft needs an automatic fix pass. Automatic repair retries use temperature ${data.config.repairTemperature}.`,
    formatBody: (data) => data.repairPromptTemplate,
  },
  {
    title: 'Output envelope schema',
    description: 'Structured output schema for `kitto_openui_source`.',
    formatBody: (data) => formatJson(data.envelopeSchema),
  },
] as const;

const promptReferenceSectionByTitle = new Map(PROMPT_REFERENCE_SECTIONS.map((section) => [section.title, section] as const));

function cloneRecord(value?: Record<string, unknown>) {
  return structuredClone(value ?? {});
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function formatPromptInfoErrorMessage(error: unknown) {
  if (error && typeof error === 'object') {
    if ('status' in error && 'error' in error && typeof error.error === 'string') {
      return error.error;
    }

    if ('status' in error && 'data' in error) {
      return `Request failed with status ${String(error.status)}.`;
    }

    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }
  }

  return 'Failed to load prompt info.';
}

function getComponentSchema(componentName: string): ComponentSchema {
  return (librarySchema.$defs?.[componentName] as ComponentSchema | undefined) ?? {};
}

function getOpenUiSchema(componentName: string, schema: ComponentSchema) {
  const spec = (librarySpec.components as Record<string, { description?: string; signature?: string } | undefined>)[componentName];
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

function PromptReferencePanel({
  body,
}: {
  body: string;
}) {
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-h-7 items-center">
        <ActionSectionHeading>Snapshot</ActionSectionHeading>
      </div>
      <pre className="max-h-[32rem] w-full overflow-auto whitespace-pre-wrap break-words rounded-[1.25rem] bg-slate-950 p-4 text-xs leading-6 text-slate-100">
        <code>{body}</code>
      </pre>
    </div>
  );
}

function getInitialReferenceTab(): ReferenceTabId {
  if (typeof window === 'undefined') {
    return 'elements';
  }

  return resolveReferenceTargetFromHash(window.location.hash)?.tab ?? 'elements';
}

function getInitialReferenceTargetId() {
  if (typeof window === 'undefined') {
    return null;
  }

  return resolveReferenceTargetFromHash(window.location.hash)?.id ?? null;
}

function ReferenceTableOfContents({ items }: { items: ReactNode[] }) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-4">
      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Contents</p>
      <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {items}
      </div>
    </div>
  );
}

function ReferenceTableOfContentsGroup({ group }: { group: ReferenceGroup }) {
  return (
    <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4">
      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500">{group.label}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {group.items.map((item) => (
          <a
            key={item.id}
            className="inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-950"
            href={`#${item.id}`}
          >
            {item.label}
          </a>
        ))}
      </div>
    </div>
  );
}

function ReferenceContentGroup({
  children,
  group,
}: {
  children: ReactNode;
  group: ReferenceGroup;
}) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/40 p-4 sm:p-5">
      <div className="flex min-h-7 items-center">
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-slate-500">{group.label}</p>
      </div>
      <div className="mt-4 grid min-w-0 gap-4">{children}</div>
    </div>
  );
}

function BackToTopButton() {
  return (
    <Button
      aria-label="Scroll to top of page"
      className="h-7 w-7 rounded-lg border border-slate-200 p-0 shadow-none"
      size="icon"
      title="Back to top"
      type="button"
      variant="secondary"
      onClick={() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      }}
    >
      <ArrowUp className="h-3.5 w-3.5" />
    </Button>
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
  const [activeTab, setActiveTab] = useState<ReferenceTabId>(() => getInitialReferenceTab());
  const [hashTargetId, setHashTargetId] = useState<string | null>(() => getInitialReferenceTargetId());
  const { data: promptsInfo, error: promptsInfoError, isError: isPromptsInfoError, isLoading: isPromptsInfoLoading } = useGetPromptsInfoQuery();

  useEffect(() => {
    const rootElement = document.documentElement;
    const previousScrollBehavior = rootElement.style.scrollBehavior;
    rootElement.style.scrollBehavior = 'smooth';

    return () => {
      rootElement.style.scrollBehavior = previousScrollBehavior;
    };
  }, []);

  useEffect(() => {
    function syncNavigationFromHash() {
      const target = resolveReferenceTargetFromHash(window.location.hash);
      setHashTargetId(target?.id ?? null);

      if (target) {
        setActiveTab(target.tab);
      }
    }

    syncNavigationFromHash();
    window.addEventListener('hashchange', syncNavigationFromHash);

    return () => {
      window.removeEventListener('hashchange', syncNavigationFromHash);
    };
  }, []);

  useEffect(() => {
    if (!hashTargetId) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      document.getElementById(hashTargetId)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeTab, hashTargetId]);

  return (
    <section className="w-full min-w-0">
      <Tabs className="space-y-4" value={activeTab} onValueChange={(value: string) => setActiveTab(value as ReferenceTabId)}>
        <div className="flex justify-start">
          <TabsList>
            <TabsTrigger value="elements">Elements</TabsTrigger>
            <TabsTrigger value="actions">Actions</TabsTrigger>
            <TabsTrigger value="prompts">Prompts</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="elements" className="mt-0">
          <Card className="min-w-0 border-white/70 bg-white/92">
            <CardHeader className="border-b border-slate-200/70 pb-4">
              <CardTitle className="text-2xl">Elements</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <ReferenceTableOfContents items={ELEMENT_REFERENCE_GROUPS.map((group) => <ReferenceTableOfContentsGroup key={group.id} group={group} />)} />
              <div className="grid min-w-0 gap-5">
                {ELEMENT_REFERENCE_GROUPS.map((group) => (
                  <ReferenceContentGroup key={group.id} group={group}>
                    {group.items.map(({ label: componentName }) => {
                      const schema = getComponentSchema(componentName);
                      const groupName = groupByComponent.get(componentName) ?? 'Components';
                      const demoDefinition = ELEMENT_DEMO_DEFINITIONS[componentName];

                      return (
                        <Card
                          key={componentName}
                          id={elementReferenceIdByName.get(componentName)}
                          className="min-w-0 scroll-mt-24 overflow-hidden border-slate-200/80 bg-slate-50/70 shadow-none"
                        >
                          <CardHeader className="border-b border-slate-200/70 pb-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <BackToTopButton />
                                <CardTitle className="min-w-0 break-words text-lg">{componentName}</CardTitle>
                              </div>
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
                  </ReferenceContentGroup>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="actions" className="mt-0">
          <Card className="min-w-0 border-white/70 bg-white/92">
            <CardHeader className="border-b border-slate-200/70 pb-4">
              <CardTitle className="text-2xl">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <ReferenceTableOfContents items={ACTION_REFERENCE_GROUPS.map((group) => <ReferenceTableOfContentsGroup key={group.id} group={group} />)} />
              <div className="grid min-w-0 gap-5">
                {ACTION_REFERENCE_GROUPS.map((group) => (
                  <ReferenceContentGroup key={group.id} group={group}>
                    {group.items.map(({ label: actionName }) => {
                      const action = actionDefinitionByName.get(actionName);

                      if (!action) {
                        return null;
                      }

                      return (
                        <Card
                          key={action.name}
                          id={actionReferenceIdByName.get(action.name)}
                          className="min-w-0 scroll-mt-24 overflow-hidden border-slate-200/80 bg-slate-50/70 shadow-none"
                        >
                          <CardHeader className="border-b border-slate-200/70 pb-4">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <BackToTopButton />
                                <CardTitle className="min-w-0 break-words text-lg">{action.signature}</CardTitle>
                              </div>
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
                      );
                    })}
                  </ReferenceContentGroup>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prompts" className="mt-0">
          <Card className="min-w-0 border-white/70 bg-white/92">
            <CardHeader className="border-b border-slate-200/70 pb-4">
              <CardTitle className="text-2xl">Prompts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <ReferenceTableOfContents items={PROMPT_REFERENCE_GROUPS.map((group) => <ReferenceTableOfContentsGroup key={group.id} group={group} />)} />
              <div className="grid min-w-0 gap-5">
                {PROMPT_REFERENCE_GROUPS.map((group) => (
                  <ReferenceContentGroup key={group.id} group={group}>
                    {group.items.map(({ label }) => {
                      const section = promptReferenceSectionByTitle.get(label as PromptReferenceSectionLabel);

                      if (!section) {
                        return null;
                      }

                      const body = isPromptsInfoLoading
                        ? 'Loading current backend prompt configuration and prompt templates.'
                        : isPromptsInfoError || !promptsInfo
                          ? formatPromptInfoErrorMessage(promptsInfoError)
                          : section.formatBody(promptsInfo);
                      const description =
                        isPromptsInfoLoading || isPromptsInfoError || !promptsInfo
                          ? typeof section.description === 'string'
                            ? section.description
                            : 'Loading current backend prompt section details.'
                          : typeof section.description === 'function'
                            ? section.description(promptsInfo)
                            : section.description;

                      return (
                        <Card
                          key={section.title}
                          id={promptReferenceIdByName.get(section.title)}
                          className="min-w-0 scroll-mt-24 overflow-hidden border-slate-200/80 bg-slate-50/70 shadow-none"
                        >
                          <CardHeader className="border-b border-slate-200/70 pb-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <BackToTopButton />
                                <CardTitle className="min-w-0 break-words text-lg">{section.title}</CardTitle>
                              </div>
                              <p className="max-w-3xl text-sm font-medium leading-6 text-slate-500">{description}</p>
                            </div>
                          </CardHeader>
                          <CardContent className="min-w-0 pt-6">
                            <PromptReferencePanel body={body} />
                          </CardContent>
                        </Card>
                      );
                    })}
                  </ReferenceContentGroup>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </section>
  );
}
