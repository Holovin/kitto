import { Copy, LoaderCircle, Sparkles } from 'lucide-react';
import type { Spec } from '@json-render/core';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs';
import { PreviewRuntimeBoundary } from './PreviewRuntimeBoundary';
import { BuilderRuntimeProviders } from '../jsonui/runtime/providers';

type PreviewDemoAction = {
  id: string;
  label: string;
  presetId: string;
};

type PreviewTabsProps = {
  spec: Spec | null;
  isStreaming: boolean;
  definitionJson: string;
  structuralIssues: string[];
  catalogIssues: string[];
  onCopy: () => Promise<void>;
  onResetEmpty: () => void;
  onLoadDemo: (presetId: string) => void;
  demoActions: readonly PreviewDemoAction[];
  panelError: string | null;
  onDismissPanelError: () => void;
};

export function PreviewTabs({
  spec,
  isStreaming,
  definitionJson,
  structuralIssues,
  catalogIssues,
  onCopy,
  onResetEmpty,
  onLoadDemo,
  demoActions,
  panelError,
  onDismissPanelError,
}: PreviewTabsProps) {
  return (
    <Tabs defaultValue="preview" className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <CardTitle className="text-3xl font-semibold tracking-tight md:text-4xl">Preview and definition</CardTitle>
        <TabsList className="rounded-full p-1">
          <TabsTrigger value="preview" className="rounded-full px-6">
            Preview
          </TabsTrigger>
          <TabsTrigger value="definition" className="rounded-full px-6">
            Definition
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="preview" className="mt-0 min-h-0 flex-1 w-full">
        <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-[2rem] border-border/70 bg-card/95">
          <CardContent className="flex min-h-0 flex-1 flex-col p-5 md:p-6">
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-background/70 p-5 md:p-6">
              {panelError ? (
                <div className="mb-4 shrink-0 flex items-start justify-between gap-3 rounded-[1.5rem] border border-destructive/20 bg-destructive/10 px-5 py-4 text-sm text-destructive">
                  <span>{panelError}</span>
                  <button type="button" className="shrink-0 underline-offset-4 hover:underline" onClick={onDismissPanelError}>
                    Dismiss
                  </button>
                </div>
              ) : null}

              {isStreaming ? (
                <div className="absolute right-5 top-5 inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/90 px-3 py-1 text-xs text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin" />
                  Updating preview
                </div>
              ) : null}

              {spec ? (
                <div className="min-h-0 flex-1 overflow-auto">
                  <div className="min-h-full w-full pr-4">
                    <PreviewRuntimeBoundary
                      onClear={onResetEmpty}
                      clearLabel="Reset"
                      resetKeys={[spec.root, Object.keys(spec.elements).length, isStreaming ? 'streaming' : 'idle']}
                    >
                      <BuilderRuntimeProviders spec={spec} loading={isStreaming} />
                    </PreviewRuntimeBoundary>
                  </div>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto">
                  <div className="flex min-h-full flex-col items-center justify-center gap-8 px-4 py-8 text-center">
                    <div className="flex size-18 items-center justify-center rounded-full border border-border/70 bg-background/80 text-primary">
                      <Sparkles className="size-8" />
                    </div>

                    <h3 className="text-3xl font-semibold tracking-tight text-foreground">Preview is empty</h3>

                    <div className="flex max-w-5xl flex-wrap items-center justify-center gap-3">
                      {demoActions.map((action) => (
                        <Button
                          key={action.id}
                          variant="outline"
                          size="lg"
                          className="rounded-full px-6"
                          onClick={() => onLoadDemo(action.presetId)}
                          disabled={isStreaming}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="definition" className="mt-0 min-h-0 flex-1 w-full">
        <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-[2rem] border-border/70 bg-card/95">
          <CardContent className="grid h-full min-h-0 w-full gap-4 p-5 md:p-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="flex min-h-0 min-w-0 w-full flex-col gap-3">
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => void onCopy()} disabled={!spec}>
                  <Copy className="size-4" />
                  Copy
                </Button>
              </div>
              <div className="min-h-0 w-full flex-1 overflow-auto rounded-[1.75rem] border border-border/70 bg-slate-950">
                <pre className="min-h-full px-5 py-4 text-xs leading-6 text-slate-100">{definitionJson || '// No definition yet'}</pre>
              </div>
            </div>

            <div className="min-h-0 min-w-0 space-y-4 overflow-auto pr-1">
              <Card className="border-border/70 bg-background/75">
                <CardHeader>
                  <CardTitle className="text-base">Validation</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {structuralIssues.length === 0 && catalogIssues.length === 0 ? (
                    <p className="text-emerald-600">No validation issues detected.</p>
                  ) : null}

                  {structuralIssues.length > 0 ? (
                    <div className="space-y-2">
                      <p className="font-medium text-foreground">Structure</p>
                      <ul className="space-y-2 text-muted-foreground">
                        {structuralIssues.map((issue) => (
                          <li key={issue}>• {issue}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {catalogIssues.length > 0 ? (
                    <div className="space-y-2">
                      <p className="font-medium text-foreground">Catalog</p>
                      <ul className="space-y-2 text-muted-foreground">
                        {catalogIssues.map((issue) => (
                          <li key={issue}>• {issue}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
