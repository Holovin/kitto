import { useEffect, useEffectEvent, useRef, useState, type MutableRefObject } from 'react';
import { Download, FileUp, Redo2, RotateCcw, Send, Square, Undo2 } from 'lucide-react';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { Textarea } from '@components/ui/textarea';
import { useBackendConnectionState } from '@features/builder/hooks/useBuilderBootstrap';
import { useBuilderHistoryControls } from '@features/builder/hooks/useBuilderHistoryControls';
import { useBuilderSubmission } from '@features/builder/hooks/useBuilderSubmission';
import { selectChatMessages, selectCommittedSource } from '@features/builder/store/selectors';
import type { BuilderChatMessage } from '@features/builder/types';
import { useAppSelector } from '@store/hooks';

interface ChatToolbarProps {
  cancelActiveRequestRef: MutableRefObject<(() => void) | null>;
  onFeedbackChange: (message: string | null) => void;
}

interface ChatComposerProps {
  abortControllerRef: MutableRefObject<AbortController | null>;
  cancelActiveRequestRef: MutableRefObject<(() => void) | null>;
  onFeedbackChange: (message: string | null) => void;
}

function getMessageBubbleClasses(message: BuilderChatMessage) {
  if (message.role === 'user') {
    return 'ml-auto border-slate-900 bg-slate-950 text-white';
  }

  if (message.tone === 'error') {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }

  if (message.tone === 'success') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }

  return 'border-slate-200 bg-white text-slate-700';
}

function ChatToolbar({ cancelActiveRequestRef, onFeedbackChange }: ChatToolbarProps) {
  const {
    canExport,
    canRedo,
    canReset,
    canUndo,
    fileInputRef,
    handleExport,
    handleImport,
    handleRedo,
    handleResetToEmpty,
    handleUndo,
  } = useBuilderHistoryControls({
    cancelActiveRequestRef,
    onFeedbackChange,
  });
  const toolbarButtonClassName =
    'h-7 rounded-lg border border-slate-200 bg-white/70 px-2 text-xs shadow-none hover:bg-white';
  const toolbarIconButtonClassName =
    'h-7 w-7 rounded-lg border border-slate-200 bg-white/70 px-0 shadow-none hover:bg-white';

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 xl:justify-end">
      <Button
        className={toolbarButtonClassName}
        disabled={!canExport}
        size="sm"
        variant="ghost"
        onClick={handleExport}
      >
        <Download className="h-4 w-4" />
        Export
      </Button>
      <Button
        className={toolbarButtonClassName}
        size="sm"
        variant="ghost"
        onClick={() => fileInputRef.current?.click()}
      >
        <FileUp className="h-4 w-4" />
        Import
      </Button>
      <Button
        aria-label="Undo"
        className={toolbarIconButtonClassName}
        disabled={!canUndo}
        size="sm"
        variant="ghost"
        onClick={handleUndo}
      >
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button
        aria-label="Redo"
        className={toolbarIconButtonClassName}
        disabled={!canRedo}
        size="sm"
        variant="ghost"
        onClick={handleRedo}
      >
        <Redo2 className="h-4 w-4" />
      </Button>
      <Button
        className={toolbarButtonClassName}
        disabled={!canReset}
        size="sm"
        variant="ghost"
        onClick={handleResetToEmpty}
      >
        <RotateCcw className="h-4 w-4" />
        Reset
      </Button>
      <input ref={fileInputRef} accept="application/json" className="hidden" type="file" onChange={handleImport} />
    </div>
  );
}

function ChatHistoryFeed({ feedback }: { feedback: string | null }) {
  const chatMessages = useAppSelector(selectChatMessages);
  const { isError: isBackendDisconnected } = useBackendConnectionState();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const showEmptyChatHint = !isBackendDisconnected && !feedback && chatMessages.length === 0;
  const scrollToLatestMessage = useEffectEvent(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  });

  useEffect(() => {
    scrollToLatestMessage();
  }, [chatMessages.length, feedback, isBackendDisconnected]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <div className="space-y-3 pr-1" style={{ containIntrinsicSize: '720px', contentVisibility: 'auto' }}>
        {isBackendDisconnected ? (
          <article className="max-w-full rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
            Backend is disconnected. You can still inspect the last persisted definition, but new prompts will fail until
            <span className="font-semibold"> /api/health </span>
            recovers.
          </article>
        ) : null}

        {feedback ? (
          <article className="max-w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
            {feedback}
          </article>
        ) : null}

        {showEmptyChatHint ? (
          <article className="max-w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700">
            Describe the app or change you want.
          </article>
        ) : null}

        {chatMessages.map((message) => (
          <article
            key={message.id}
            className={`max-w-[92%] rounded-lg border px-4 py-3 text-sm leading-6 ${getMessageBubbleClasses(message)}`}
          >
            <p>{message.content}</p>
          </article>
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

function ChatComposer({ abortControllerRef, cancelActiveRequestRef, onFeedbackChange }: ChatComposerProps) {
  const { draftPrompt, handleCancel, handleDraftPromptChange, handleSubmit, isSubmitting, promptMaxChars } = useBuilderSubmission({
    abortControllerRef,
    cancelActiveRequestRef,
    onFeedbackChange,
  });
  const committedSource = useAppSelector(selectCommittedSource);
  const submitButtonLabel = isSubmitting ? (!committedSource.trim() ? 'Generating...' : 'Updating...') : 'Send';

  return (
    <form className="shrink-0 border-t border-slate-200/70 px-6 py-5" onSubmit={handleSubmit}>
      <Textarea
        className="min-h-[8rem] w-full text-[0.8rem] leading-5 shadow-none"
        maxLength={promptMaxChars}
        placeholder="Describe the app or change you want."
        value={draftPrompt}
        onChange={(event) => handleDraftPromptChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Press Cmd/Ctrl+Enter to send.</p>
        <div className="flex items-center gap-2">
          {isSubmitting ? (
            <Button type="button" variant="ghost" onClick={handleCancel}>
              <Square className="h-4 w-4" />
              Cancel
            </Button>
          ) : null}
          <Button disabled={!draftPrompt.trim() || isSubmitting} type="submit">
            <Send className="h-4 w-4" />
            {submitButtonLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function ChatPanel() {
  const abortControllerRef = useRef<AbortController | null>(null);
  const cancelActiveRequestRef = useRef<(() => void) | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const abortCurrentRequest = useEffectEvent(() => {
    cancelActiveRequestRef.current?.();
  });

  useEffect(() => {
    return () => {
      abortCurrentRequest();
    };
  }, []);

  return (
    <Card className="flex h-full min-h-0 flex-col border-white/70 bg-white/92">
      <CardHeader className="flex flex-wrap items-center gap-3 border-b border-slate-200/70 pb-4">
        <CardTitle className="shrink-0 text-2xl">Chat</CardTitle>
        <ChatToolbar
          cancelActiveRequestRef={cancelActiveRequestRef}
          onFeedbackChange={setFeedback}
        />
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <ChatHistoryFeed feedback={feedback} />
        <ChatComposer
          abortControllerRef={abortControllerRef}
          cancelActiveRequestRef={cancelActiveRequestRef}
          onFeedbackChange={setFeedback}
        />
      </CardContent>
    </Card>
  );
}
