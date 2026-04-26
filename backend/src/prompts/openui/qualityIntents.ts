import intentPatterns from '@kitto-openui/shared/openui-quality-intents.json' with { type: 'json' };

function buildPattern(fragments: string[]) {
  return new RegExp(fragments.join('|'), 'i');
}

const simpleTodoIntentPattern = buildPattern(intentPatterns.simpleTodo.includePatterns);
const simpleTodoAntiPattern = buildPattern(intentPatterns.simpleTodo.antiPatterns);
const blockingTodoIntentPattern = buildPattern(intentPatterns.blockingTodo.includePatterns);
const blockingTodoAntiPattern = buildPattern(intentPatterns.blockingTodo.antiPatterns);

export function promptMentionsTodoIntent(prompt: string) {
  return simpleTodoIntentPattern.test(prompt);
}

export function promptHasSimpleTodoIntent(prompt: string) {
  return promptMentionsTodoIntent(prompt) && !simpleTodoAntiPattern.test(prompt);
}

export function promptRequiresBlockingTodoControls(prompt: string) {
  return blockingTodoIntentPattern.test(prompt) && !blockingTodoAntiPattern.test(prompt);
}
