export const ACTION_MODE_LAST_CHOICE_STATE = '$lastChoice';

export type ActionModeQueueName = 'checkbox' | 'choice';

const actionQueueRegistry = new Map<ActionModeQueueName, Promise<void>>();

export function enqueueAction(queueName: ActionModeQueueName, runAction: () => Promise<void>) {
  const activeQueue = actionQueueRegistry.get(queueName) ?? Promise.resolve();
  const nextAction = activeQueue.then(runAction, runAction);

  actionQueueRegistry.set(queueName, nextAction.catch(() => undefined));

  return nextAction;
}

export function enqueueChoiceAction(runAction: () => Promise<void>) {
  return enqueueAction('choice', runAction);
}
