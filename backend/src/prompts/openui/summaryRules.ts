export const STRUCTURED_OUTPUT_SUMMARY_REQUIREMENT_LINES = [
  'The `summary` MUST describe the visible app/change in one complete user-facing sentence under 200 characters.',
  'Mention concrete features/screens, not generic phrases like "Updated the app" or "Updated the app definition".',
  'End the summary with normal sentence punctuation and do not trail off.',
  'Bad: "Updated the app." Good: "Added a required email field with inline validation to the signup form."',
  'Bad summary: "Made the requested changes." Good summary: "Adds a search filter above the product list and keeps existing item cards."',
] as const;

export const COMPACT_STRUCTURED_OUTPUT_SUMMARY_REQUIREMENT =
  'Make `summary` one complete user-facing sentence under 200 characters with concrete features/screens, not generic "Updated the app" text.';

export const STRUCTURED_OUTPUT_SUMMARY_INSTRUCTION = [
  'Always include a concise human-readable `summary`.',
  ...STRUCTURED_OUTPUT_SUMMARY_REQUIREMENT_LINES,
].join(' ');
