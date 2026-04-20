import intentPatterns from '../../../../../../shared/openui-quality-intents.json';

function buildPattern(fragments: string[]) {
  return new RegExp(fragments.join('|'), 'i');
}

const simpleTodoIntentPattern = buildPattern(intentPatterns.simpleTodo.includePatterns);
const simpleTodoAntiPattern = buildPattern(intentPatterns.simpleTodo.antiPatterns);

export function promptMentionsTodoIntent(prompt: string) {
  return simpleTodoIntentPattern.test(prompt);
}

export function promptHasSimpleTodoIntent(prompt: string) {
  return promptMentionsTodoIntent(prompt) && !simpleTodoAntiPattern.test(prompt);
}
