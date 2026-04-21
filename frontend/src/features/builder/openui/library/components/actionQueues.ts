export type ActionModeQueueName = 'checkbox' | 'choice';

const actionQueues = new Map<ActionModeQueueName, Promise<void>>();

export function enqueueAction(queueName: ActionModeQueueName, runAction: () => Promise<void>) {
  const activeQueue = actionQueues.get(queueName) ?? Promise.resolve();
  const nextAction = activeQueue.then(runAction, runAction);

  actionQueues.set(queueName, nextAction.catch(() => undefined));

  return nextAction;
}
