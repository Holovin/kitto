import type { ChangeEvent, KeyboardEvent } from 'react';
import { useEffect, useId, useMemo, useRef } from 'react';
import { ArrowUpRight, CornerDownLeft, Download, LoaderCircle, Redo2, RefreshCcw, Undo2, Upload } from 'lucide-react';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { ScrollArea } from '@components/ui/scroll-area';
import { Separator } from '@components/ui/separator';
import { Textarea } from '@components/ui/textarea';
import type { BackendStatus } from '@features/system/useBackendStatus';
import { cn } from '@lib/utils';
import type { BuilderMessage } from '../utils/state';

type ChatPanelProps = {
  messages: BuilderMessage[];
  prompt: string;
  promptLength: number;
  promptMaxChars: number | null;
  onPromptChange: (value: string) => void;
  onSend: () => void;
  onExport: () => void;
  onImport: (contents: string) => void;
  onAuxError: (message: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onResetEmpty: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isStreaming: boolean;
  requestError: string | null;
  requestNotice: string | null;
  backendStatus: BackendStatus;
};

function MessageBubble({ message }: { message: BuilderMessage }) {
  return (
    <div
      className={cn(
        'rounded-[1.25rem] border px-4 py-3 text-sm shadow-sm',
        message.role === 'user'
          ? 'ml-auto max-w-[88%] border-primary/20 bg-primary/10 text-foreground'
          : 'max-w-[92%] border-border/70 bg-background/80 text-foreground',
      )}
    >
      <p className="mb-2 text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
        {message.role === 'user' ? 'Builder Prompt' : message.role === 'assistant' ? 'Kitto' : 'System'}
      </p>
      <p className="whitespace-pre-wrap leading-6">{message.content}</p>
    </div>
  );
}

export function ChatPanel({
  messages,
  prompt,
  promptLength,
  promptMaxChars,
  onPromptChange,
  onSend,
  onExport,
  onImport,
  onAuxError,
  onUndo,
  onRedo,
  onResetEmpty,
  canUndo,
  canRedo,
  isStreaming,
  requestError,
  requestNotice,
  backendStatus,
}: ChatPanelProps) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const importInputId = useId();
  const displayMessages = useMemo(
    () =>
      messages.length > 0
        ? messages
        : [
            {
              id: 'assistant-empty-state',
              role: 'assistant' as const,
              content: 'Describe the app or change you want.',
              createdAt: '',
            },
          ],
    [messages],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [displayMessages.length]);

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      onSend();
    }
  }

  async function handleImportChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const contents = await file.text();
      onImport(contents);
    } catch (importError) {
      const message = importError instanceof Error ? importError.message : 'Failed to read the selected definition file.';
      onAuxError(message);
    } finally {
      event.target.value = '';
    }
  }

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-[2rem] border-border/70 bg-card/95">
      <CardHeader className="gap-4 border-b border-border/60 px-5 pb-4 pt-5 md:px-6 md:pt-6">
        <div className="space-y-4">
          <CardTitle className="text-center text-3xl font-semibold tracking-tight text-foreground">Chat</CardTitle>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <input
              id={importInputId}
              ref={importInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={handleImportChange}
            />
            <Button variant="outline" size="sm" onClick={onExport}>
              <Download className="size-4" />
              Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => importInputRef.current?.click()}>
              <Upload className="size-4" />
              Import
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="size-11 rounded-2xl px-0"
              onClick={onUndo}
              disabled={!canUndo || isStreaming}
            >
              <Undo2 className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="size-11 rounded-2xl px-0"
              onClick={onRedo}
              disabled={!canRedo || isStreaming}
            >
              <Redo2 className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onResetEmpty} disabled={isStreaming}>
              <RefreshCcw className="size-4" />
              Reset
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5 pt-4 md:px-6 md:pb-6">
        {backendStatus === 'offline' ? (
          <div className="mb-4 rounded-[1.5rem] border border-destructive/20 bg-destructive/10 px-5 py-4 text-sm text-destructive">
            Backend is disconnected. You can still inspect the last persisted definition, but new prompts will fail until `/api/health`
            recovers.
          </div>
        ) : null}

        {backendStatus === 'misconfigured' ? (
          <div className="mb-4 rounded-[1.5rem] border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm text-amber-950">
            Backend is reachable, but OpenAI is not configured. You can review the current definition, but new prompts will fail until
            `OPENAI_API_KEY` is configured.
          </div>
        ) : null}

        {requestNotice ? (
          <div className="mb-4 rounded-[1.5rem] border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm text-amber-950">{requestNotice}</div>
        ) : null}

        {requestError ? (
          <div className="mb-4 rounded-[1.5rem] border border-destructive/20 bg-destructive/10 px-5 py-4 text-sm text-destructive">{requestError}</div>
        ) : null}

        <ScrollArea className="min-h-[16rem] flex-1">
          <div className="space-y-3 px-4 pb-4 pt-2 pr-3">
            {displayMessages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        <Separator className="shrink-0" />

        <div className="shrink-0 space-y-4 pt-4">
          <Textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Describe the app or change you want."
            disabled={isStreaming}
            maxLength={promptMaxChars ?? undefined}
            style={{ resize: 'none' }}
            className="mx-4 h-32 min-h-32 max-h-[40vh] !resize-none rounded-[1.5rem] border-border/70 bg-background/80"
          />

          <Separator />

          <div className="flex flex-wrap items-center justify-between gap-3 px-4">
            <p className="text-xs text-muted-foreground">
              <CornerDownLeft className="mr-1 inline size-3.5" />
              Press Cmd/Ctrl+Enter to send.
            </p>
            <p className="text-xs text-muted-foreground">
              {promptMaxChars ? `${promptLength}/${promptMaxChars}` : `${promptLength} chars`}
            </p>
            <Button onClick={onSend} disabled={isStreaming || prompt.trim().length === 0} size="lg" className="rounded-full px-7">
              {isStreaming ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
              {isStreaming ? 'Generating…' : 'Send'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
