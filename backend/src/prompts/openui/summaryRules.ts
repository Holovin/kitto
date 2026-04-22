export const STRUCTURED_OUTPUT_SUMMARY_REQUIREMENT_LINES = [
  'The `summary` MUST describe the visible app/change in 1-2 short user-facing sentences.',
  'Mention concrete features/screens, not generic phrases like "Updated the app" or "Updated the app definition".',
] as const;

export const COMPACT_STRUCTURED_OUTPUT_SUMMARY_REQUIREMENT =
  'Make `summary` a short user-facing description of the visible app/change with concrete features/screens, not generic "Updated the app" text.';

export const STRUCTURED_OUTPUT_SUMMARY_INSTRUCTION = [
  'Always include a concise human-readable `summary`.',
  ...STRUCTURED_OUTPUT_SUMMARY_REQUIREMENT_LINES,
].join(' ');
