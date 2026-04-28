export const STRUCTURED_OUTPUT_SUMMARY_REQUIREMENT_LINES = [
  'The `summary` MUST describe the visible app/change in one complete user-facing sentence under 200 characters.',
  'Mention concrete features/screens, not generic phrases like "Updated the app" or "Updated the app definition".',
  'End the summary with normal sentence punctuation and do not trail off.',
  'Bad: "Updated the app." Good: "Added a required email field with inline validation to the signup form."',
  'Bad summary: "Made the requested changes." Good summary: "Adds a search filter above the product list and keeps existing item cards."',
] as const;

export const COMPACT_STRUCTURED_OUTPUT_SUMMARY_REQUIREMENT =
  'Return summary, changeSummary, source, and appMemory. Make `summary` one user-facing sentence under 200 characters, `changeSummary` one technical sentence under 300 characters, and return a full updated `appMemory` object under 4096 characters with version, appSummary, userPreferences, and avoid only.';

export const STRUCTURED_OUTPUT_SUMMARY_INSTRUCTION = [
  'Return a strict JSON object with:',
  '- summary: one concise user-facing sentence under 200 chars.',
  '- changeSummary: one compact technical sentence under 300 chars describing only this generation/change.',
  '- source: the complete updated OpenUI Lang program.',
  '- appMemory: the full updated compact memory of the committed app, shaped as { "version": 1, "appSummary": "...", "userPreferences": [], "avoid": [] } and under 4096 chars.',
  'Update appMemory from the previous appMemory, latest user request, and generated source.',
  'Use appSummary only for a brief description of the current app and what must be preserved.',
  'Use userPreferences only for durable user preferences.',
  'Use avoid only for things the user removed or prohibited reintroducing.',
  'Do not include recentChanges, stateModel, visibleStructure, runtime preview data, full OpenUI source text, or system prompt text in appMemory.',
  'Do not include runtime preview data in appMemory.',
  'Do not include the system prompt or OpenUI source text inside appMemory.',
  ...STRUCTURED_OUTPUT_SUMMARY_REQUIREMENT_LINES,
].join(' ');
