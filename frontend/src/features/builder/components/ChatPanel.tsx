import { memo, useEffect, useEffectEvent, useRef, type MutableRefObject } from 'react';
import { ArrowLeft, ArrowRight, RotateCcw, Send, Square } from 'lucide-react';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { Textarea } from '@components/ui/textarea';
import { getBuilderComposerSubmitState } from '@features/builder/hooks/submissionPrompt';
import { useBackendConnectionState } from '@features/builder/hooks/useBuilderBootstrap';
import { useBuilderHistoryControls } from '@features/builder/hooks/useBuilderHistoryControls';
import { useBuilderSubmission } from '@features/builder/hooks/useBuilderSubmission';
import { resolveBackendConnectionNotice } from '@features/builder/components/chatNotices';
import { SYSTEM_CHAT_MESSAGE_KEYS } from '@features/builder/store/chatMessageKeys';
import { selectChatMessages, selectCommittedSource } from '@features/builder/store/selectors';
import type { BuilderChatMessage, BuilderChatNotice } from '@features/builder/types';
import { useAppSelector } from '@store/hooks';

interface ChatToolbarProps {
  cancelActiveRequestRef: MutableRefObject<(() => void) | null>;
  onSystemNotice: (notice: BuilderChatNotice | null) => void;
}

interface ChatComposerProps {
  abortControllerRef: MutableRefObject<AbortController | null>;
  cancelActiveRequestRef: MutableRefObject<(() => void) | null>;
  onSystemNotice: (notice: BuilderChatNotice | null) => void;
}

interface ChatPanelProps {
  cancelActiveRequestRef: MutableRefObject<(() => void) | null>;
  onSystemNotice: (notice: BuilderChatNotice | null) => void;
}

function getMessageBubbleClasses(message: BuilderChatMessage) {
  if (message.role === 'user') {
    return 'ml-auto border-slate-900 bg-slate-950 text-white';
  }

  if (message.role === 'assistant') {
    return 'border-slate-200 bg-slate-100 text-slate-700';
  }

  if (message.tone === 'error') {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }

  if (message.tone === 'success') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }

  return 'border-slate-200 bg-white text-slate-700';
}

const ChatMessageBubble = memo(function ChatMessageBubble({ message }: { message: BuilderChatMessage }) {
  return (
    <article
      className={`max-w-[92%] rounded-lg border px-4 py-3 text-sm leading-6 ${getMessageBubbleClasses(message)}`}
    >
      <p className="whitespace-pre-wrap break-words">{message.content}</p>
    </article>
  );
});

function findLatestMessageByKey(messages: BuilderChatMessage[], messageKey: BuilderChatMessage['messageKey']) {
  if (!messageKey) {
    return null;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.messageKey === messageKey) {
      return messages[index] ?? null;
    }
  }

  return null;
}

function ChatToolbar({ cancelActiveRequestRef, onSystemNotice }: ChatToolbarProps) {
  const {
    canRedo,
    canReset,
    canUndo,
    handleRedo,
    handleResetToEmpty,
    handleUndo,
    historyVersionLabel,
  } = useBuilderHistoryControls({
    cancelActiveRequestRef,
    onSystemNotice,
  });
  const toolbarButtonClassName =
    'h-7 rounded-lg border border-slate-200 bg-white/70 px-2 text-xs shadow-none hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950';
  const toolbarIconButtonClassName =
    'h-7 w-7 rounded-lg border border-slate-200 bg-white/70 px-0 shadow-none hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950';
  const toolbarVersionBadgeClassName = 'text-[0.78rem] font-medium whitespace-nowrap';
  const toolbarVersionGroupClassName = 'flex items-center gap-1.5 px-1';
  const toolbarVersionLabelClassName = 'text-[0.72rem] font-medium whitespace-nowrap';

  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className={toolbarVersionGroupClassName} style={{ color: 'var(--fg-3, #94a3b8)' }}>
        <span className={toolbarVersionLabelClassName}>Version:</span>
        <span aria-live="polite" className={toolbarVersionBadgeClassName}>
          {historyVersionLabel}
        </span>
      </div>
      <Button
        aria-label="Previous version"
        className={toolbarIconButtonClassName}
        disabled={!canUndo}
        size="sm"
        variant="ghost"
        onClick={handleUndo}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Button
        aria-label="Next version"
        className={toolbarIconButtonClassName}
        disabled={!canRedo}
        size="sm"
        variant="ghost"
        onClick={handleRedo}
      >
        <ArrowRight className="h-4 w-4" />
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
    </div>
  );
}

function ChatHistoryFeed({ onSystemNotice }: { onSystemNotice: (notice: BuilderChatNotice | null) => void }) {
  const chatMessages = useAppSelector(selectChatMessages);
  const { isError: isBackendDisconnected } = useBackendConnectionState();
  const previousDisconnectedRef = useRef<boolean | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const backendStatusMessage = findLatestMessageByKey(chatMessages, SYSTEM_CHAT_MESSAGE_KEYS.backendConnectionStatus);
  const lastMessageId = chatMessages.at(-1)?.id ?? null;
  const showEmptyChatHint = !isBackendDisconnected && chatMessages.length === 0;
  const scrollToLatestMessage = useEffectEvent(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  });

  useEffect(() => {
    const nextNotice = resolveBackendConnectionNotice({
      backendStatusContent: backendStatusMessage?.content ?? null,
      isBackendDisconnected,
      previouslyDisconnected: previousDisconnectedRef.current,
    });

    previousDisconnectedRef.current = isBackendDisconnected;

    if (nextNotice) {
      onSystemNotice(nextNotice);
    }
  }, [backendStatusMessage?.content, isBackendDisconnected, onSystemNotice]);

  useEffect(() => {
    scrollToLatestMessage();
  }, [chatMessages.length, lastMessageId]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <div className="space-y-3 pr-1" style={{ containIntrinsicSize: '720px', contentVisibility: 'auto' }}>
        {showEmptyChatHint ? (
          <article className="max-w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700">
            Describe the app or change you want.
          </article>
        ) : null}

        {chatMessages.map((message) => (
          <ChatMessageBubble key={message.id} message={message} />
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

function ChatComposer({ abortControllerRef, cancelActiveRequestRef, onSystemNotice }: ChatComposerProps) {
  const { configStatus, draftPrompt, handleCancel, handleDraftPromptChange, handleSubmit, isSubmitting, promptMaxChars, retryPrompt } =
    useBuilderSubmission({
      abortControllerRef,
      cancelActiveRequestRef,
      onSystemNotice,
    });
  const committedSource = useAppSelector(selectCommittedSource);
  const submitButtonState = getBuilderComposerSubmitState({
    configStatus,
    draftPrompt,
    hasCommittedSource: Boolean(committedSource.trim()),
    isSubmitting,
    retryPrompt,
  });
  const composerHint =
    configStatus === 'loading'
      ? 'Runtime config is still loading. Chat send will unlock after /api/config is ready.'
      : configStatus === 'failed'
        ? 'Runtime config is unavailable. Chat send is disabled until /api/config can be loaded.'
        : 'Press Cmd/Ctrl+Enter to send.';
  const composerHintToneClassName = configStatus === 'failed' ? 'text-rose-600' : configStatus === 'loading' ? 'text-amber-700' : 'text-slate-500';

  return (
    <form className="shrink-0 border-t border-slate-200/70 px-6 py-5" onSubmit={handleSubmit}>
      <Textarea
        autoComplete="off"
        className="min-h-[8rem] w-full text-[0.8rem] leading-5 shadow-none"
        id="builder-prompt"
        maxLength={promptMaxChars}
        name="builder-prompt"
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
        <p aria-live="polite" className={`text-xs ${composerHintToneClassName}`}>
          {composerHint}
        </p>
        <div className="flex items-center gap-2">
          {isSubmitting ? (
            <Button type="button" variant="ghost" onClick={handleCancel}>
              <Square className="h-4 w-4" />
              Cancel
            </Button>
          ) : null}
          <span title={configStatus === 'loaded' ? undefined : composerHint}>
            <Button disabled={submitButtonState.disabled} type="submit">
              <Send className="h-4 w-4" />
              {submitButtonState.label}
            </Button>
          </span>
        </div>
      </div>
    </form>
  );
}

export function ChatPanel({ cancelActiveRequestRef, onSystemNotice }: ChatPanelProps) {
  const abortControllerRef = useRef<AbortController | null>(null);
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
      <CardHeader className="flex-row items-center justify-between gap-4 border-b border-slate-200/70 pb-4">
        <CardTitle className="shrink-0 text-2xl">Chat</CardTitle>
        <ChatToolbar
          cancelActiveRequestRef={cancelActiveRequestRef}
          onSystemNotice={onSystemNotice}
        />
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <ChatHistoryFeed onSystemNotice={onSystemNotice} />
        <ChatComposer
          abortControllerRef={abortControllerRef}
          cancelActiveRequestRef={cancelActiveRequestRef}
          onSystemNotice={onSystemNotice}
        />
      </CardContent>
    </Card>
  );
}
