import type { PromptIntentVector } from './promptIntents.js';

export type PromptIntentKey = keyof PromptIntentVector;

export interface IntentAnchorExample {
  intent: PromptIntentKey;
  text: string;
  weight?: number;
}

export const INTENT_ANCHOR_EXAMPLES: readonly IntentAnchorExample[] = [
  { intent: 'todo', text: 'add a task' },
  { intent: 'todo', text: 'build a task tracker' },
  { intent: 'todo', text: 'create a todo list' },
  { intent: 'todo', text: 'task manager with completion toggles' },
  { intent: 'random', text: 'dice roller' },
  { intent: 'random', text: 'roll a random number' },
  { intent: 'random', text: 'random picker' },
  { intent: 'theme', text: 'dark mode toggle' },
  { intent: 'theme', text: 'light and dark theme switcher' },
  { intent: 'theme', text: 'color palette for the app' },
  { intent: 'validation', text: 'form validation' },
  { intent: 'validation', text: 'required field warning' },
  { intent: 'filtering', text: 'filter a list' },
  { intent: 'filtering', text: 'search catalog items' },
  { intent: 'filtering', text: 'show active and completed tasks' },
  { intent: 'multiScreen', text: 'multi step wizard' },
  { intent: 'multiScreen', text: 'separate screens quiz' },
  { intent: 'multiScreen', text: 'navigation between screens' },
  { intent: 'compute', text: 'calculate totals' },
  { intent: 'compute', text: 'compare dates' },
  { intent: 'compute', text: 'computed warning' },
  { intent: 'delete', text: 'remove an item' },
  { intent: 'delete', text: 'delete a task' },
  { intent: 'delete', text: 'remove the last screen' },
  { intent: 'controlShowcase', text: 'show every control' },
  { intent: 'controlShowcase', text: 'component showcase' },
];
