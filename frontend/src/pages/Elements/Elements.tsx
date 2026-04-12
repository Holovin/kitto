import { useEffect, useMemo, useRef, useState } from 'react';
import { type OpenUIError, type ParseResult, Renderer } from '@openuidev/react-lang';
import { RotateCcw } from 'lucide-react';
import { Badge } from '@components/ui/badge';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { builderOpenUiLibrary } from '@features/builder/openui/library';
import { OPENUI_SUPPORTED_COMPONENTS } from '@features/builder/openui/runtime/prompt';
import { OPENUI_ACTION_DEFINITIONS } from '@features/builder/openui/runtime/actionCatalog';
import { appendPathValue, mergePathValue, readPath, removePathValue, writePathValue } from '@features/builder/store/path';
import type { BuilderParseIssue } from '@features/builder/types';
import { ELEMENT_DEMO_DEFINITIONS } from './elementDemos';

type ComponentSchema = {
  properties?: Record<string, unknown>;
  required?: string[];
};

type SchemaViewMode = 'demo' | 'openui' | 'json';

type ElementSandboxProps = {
  componentName: string;
  source: string;
  initialDomainData?: Record<string, unknown>;
  initialRuntimeState?: Record<string, unknown>;
};

const librarySchema = builderOpenUiLibrary.toJSONSchema();
const librarySpec = builderOpenUiLibrary.toSpec();
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

function getPathValue(path: unknown) {
  return typeof path === 'string' ? path : '';
}

function getRecordValue(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function mapParseResultToIssues(result: ParseResult | null): BuilderParseIssue[] {
  if (!result) {
    return [];
  }

  const validationIssues = result.meta.errors.map((error) => ({
    code: error.code,
    message: error.message,
    statementId: error.statementId,
    source: 'parser',
  }));

  const unresolvedIssues =
    !result.meta.incomplete && result.meta.unresolved.length > 0
      ? result.meta.unresolved.map((statementId) => ({
          code: 'unresolved-reference',
          message: 'This statement was referenced but never defined in the final source.',
          statementId,
          source: 'parser',
        }))
      : [];

  return [...validationIssues, ...unresolvedIssues];
}

function mapOpenUiErrorsToIssues(errors: OpenUIError[]): BuilderParseIssue[] {
  return errors.map((error) => ({
    code: error.code,
    message: error.message,
    statementId: error.statementId,
    source: error.source,
  }));
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

function ElementSandbox({ componentName, source, initialDomainData, initialRuntimeState }: ElementSandboxProps) {
  const [initialDomainDataSnapshot] = useState<Record<string, unknown>>(() => cloneRecord(initialDomainData));
  const [initialRuntimeStateSnapshot] = useState<Record<string, unknown>>(() => cloneRecord(initialRuntimeState));
  const [domainData, setDomainData] = useState<Record<string, unknown>>(initialDomainDataSnapshot);
  const [runtimeState, setRuntimeState] = useState<Record<string, unknown>>(initialRuntimeStateSnapshot);
  const [parseIssues, setParseIssues] = useState<BuilderParseIssue[]>([]);
  const [runtimeIssues, setRuntimeIssues] = useState<BuilderParseIssue[]>([]);
  const [resetVersion, setResetVersion] = useState(0);
  const stateDeclarationDefaultsRef = useRef<Record<string, unknown>>({});
  const hasHydratedInitialRuntimeStateRef = useRef(false);
  const domainDataRef = useRef(domainData);

  useEffect(() => {
    domainDataRef.current = domainData;
  }, [domainData]);

  const toolProvider = useMemo(
    () => ({
      read_state: async (args: Record<string, unknown>) => {
        const path = getPathValue(args.path);
        return structuredClone(readPath(domainDataRef.current, path) ?? null);
      },
      write_state: async (args: Record<string, unknown>) => {
        const path = getPathValue(args.path);
        let nextValue: unknown = null;

        setDomainData((previousState) => {
          const nextState = cloneRecord(previousState);
          const writtenState = writePathValue(nextState, path, args.value) as Record<string, unknown>;
          nextValue = structuredClone(readPath(writtenState, path) ?? null);
          domainDataRef.current = writtenState;
          return writtenState;
        });

        return nextValue;
      },
      merge_state: async (args: Record<string, unknown>) => {
        const path = getPathValue(args.path);
        const patch = getRecordValue(args.patch ?? args.value);
        let nextValue: unknown = null;

        setDomainData((previousState) => {
          const nextState = cloneRecord(previousState);
          const mergedState = mergePathValue(nextState, path, patch);
          nextValue = structuredClone(readPath(mergedState, path) ?? null);
          domainDataRef.current = mergedState;
          return mergedState;
        });

        return nextValue;
      },
      append_state: async (args: Record<string, unknown>) => {
        const path = getPathValue(args.path);
        let nextValue: unknown = null;

        setDomainData((previousState) => {
          const nextState = cloneRecord(previousState);
          const appendedState = appendPathValue(nextState, path, args.value);
          nextValue = structuredClone(readPath(appendedState, path) ?? null);
          domainDataRef.current = appendedState;
          return appendedState;
        });

        return nextValue;
      },
      remove_state: async (args: Record<string, unknown>) => {
        const path = getPathValue(args.path);
        const index = typeof args.index === 'number' ? args.index : 0;
        let nextValue: unknown = null;

        setDomainData((previousState) => {
          const nextState = cloneRecord(previousState);
          const trimmedState = removePathValue(nextState, path, index);
          nextValue = structuredClone(readPath(trimmedState, path) ?? null);
          domainDataRef.current = trimmedState;
          return trimmedState;
        });

        return nextValue;
      },
      open_url: async (args: Record<string, unknown>) => {
        const url = typeof args.url === 'string' ? args.url : '';

        if (url) {
          window.open(url, '_blank', 'noopener,noreferrer');
        }

        return { opened: Boolean(url), url };
      },
      navigate_screen: async (args: Record<string, unknown>) => {
        const screenId = typeof args.screenId === 'string' ? args.screenId : '';
        let nextValue: unknown = null;

        setDomainData((previousState) => {
          const nextState = cloneRecord(previousState);
          const writtenState = writePathValue(nextState, 'navigation.currentScreenId', screenId) as Record<string, unknown>;
          nextValue = structuredClone(readPath(writtenState, 'navigation.currentScreenId') ?? null);
          domainDataRef.current = writtenState;
          return writtenState;
        });

        return nextValue;
      },
    }),
    [],
  );

  const allIssues = [...parseIssues, ...runtimeIssues];

  function handleReset() {
    setParseIssues([]);
    setRuntimeIssues([]);
    hasHydratedInitialRuntimeStateRef.current = false;
    setRuntimeState(mergeRuntimeDefaults(stateDeclarationDefaultsRef.current, initialRuntimeStateSnapshot));
    setDomainData(cloneRecord(initialDomainDataSnapshot));
    domainDataRef.current = cloneRecord(initialDomainDataSnapshot);
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
              <Renderer
                key={`${componentName}-${resetVersion}`}
                initialState={runtimeState}
                library={builderOpenUiLibrary}
                onError={(errors) => setRuntimeIssues(mapOpenUiErrorsToIssues(errors))}
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
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            <div className="min-w-0">
              <p className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Reactive state</p>
              <pre className="max-h-[22rem] w-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-[1.25rem] bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                <code>{formatJson(runtimeState)}</code>
              </pre>
            </div>
            <div className="min-w-0">
              <p className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Persisted data</p>
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
    <section className="w-full min-w-0 space-y-6 overflow-x-hidden">
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
        <CardContent className="grid min-w-0 gap-4 pt-6 lg:grid-cols-2">
          {OPENUI_ACTION_DEFINITIONS.map((action) => (
            <Card key={action.name} className="min-w-0 overflow-hidden border-slate-200/80 bg-slate-50/70 shadow-none">
              <CardHeader className="border-b border-slate-200/70 pb-4">
                <CardTitle className="break-words text-lg">{action.signature}</CardTitle>
              </CardHeader>
              <CardContent className="min-w-0 pt-6">
                <pre className="w-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-[1.25rem] bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                  <code>{formatJson(action.inputSchema)}</code>
                </pre>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
