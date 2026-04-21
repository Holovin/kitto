import { useRef, useState } from 'react';
import { useIsStreaming, useTriggerAction } from '@openuidev/react-lang';
import { enqueueAction, type ActionModeQueueName } from './actionQueues';

type UseActionModeControlOptions<Value> = {
  action?: unknown;
  beforeRun?: (nextValue: Value) => void;
  name: string;
  queue: ActionModeQueueName;
};

type UseActionModeControlResult<Value> = {
  isActionMode: boolean;
  isPending: boolean;
  runAction: (nextValue: Value) => Promise<void>;
};

export function useActionModeControl<Value>({
  action,
  beforeRun,
  name,
  queue,
}: UseActionModeControlOptions<Value>): UseActionModeControlResult<Value> {
  const [isPending, setPending] = useState(false);
  const pendingActionRef = useRef(false);
  const isStreaming = useIsStreaming();
  const triggerAction = useTriggerAction();
  const isActionMode = action != null;

  async function runAction(nextValue: Value) {
    if (!isActionMode || isStreaming || pendingActionRef.current) {
      return;
    }

    pendingActionRef.current = true;
    setPending(true);

    try {
      await enqueueAction(queue, async () => {
        beforeRun?.(nextValue);
        await triggerAction(name, undefined, action as never);
      });
    } finally {
      pendingActionRef.current = false;
      setPending(false);
    }
  }

  return {
    isActionMode,
    isPending,
    runAction,
  };
}
