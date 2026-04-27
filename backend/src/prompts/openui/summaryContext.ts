const LOW_SIGNAL_ASSISTANT_SUMMARY_PREFIXES = [
  'Applied the latest chat instruction',
  'Building:',
  'The model returned',
  'The first draft',
  'Definition exported',
  'Import failed',
] as const;

const LOW_SIGNAL_ASSISTANT_SUMMARY_EXACT_MATCHES = new Set([
  'updated the app',
  'made the requested changes',
  'updated the app definition from the latest chat instruction',
]);

function normalizeSummaryForMatch(summary: string) {
  return summary.trim().replace(/\s+/g, ' ').toLowerCase().replace(/\.$/, '');
}

export function getSummaryQualityWarning(summary: string) {
  return shouldExcludeSummaryFromLlmContext(summary)
    ? 'The model returned a generic summary; it was kept visible but excluded from future model context.'
    : undefined;
}

export function shouldExcludeSummaryFromLlmContext(summary: string) {
  const trimmedSummary = summary.trim();

  if (!trimmedSummary) {
    return false;
  }

  if (LOW_SIGNAL_ASSISTANT_SUMMARY_PREFIXES.some((prefix) => trimmedSummary.startsWith(prefix))) {
    return true;
  }

  return LOW_SIGNAL_ASSISTANT_SUMMARY_EXACT_MATCHES.has(normalizeSummaryForMatch(trimmedSummary));
}
