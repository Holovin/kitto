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
  'updated the current app',
  'updated the app definition',
  'updated the current app definition',
  'updated the ui',
  'updated the current ui',
  'updated the interface',
  'updated the current interface',
  'changed the app',
  'changed the current app',
  'changed the app definition',
  'changed the current app definition',
  'changed the ui',
  'changed the current ui',
  'changed the interface',
  'changed the current interface',
  'modified the app',
  'modified the current app',
  'modified the app definition',
  'modified the current app definition',
  'modified the ui',
  'modified the current ui',
  'modified the interface',
  'modified the current interface',
  'made the requested changes',
  'made the requested update',
  'applied the requested changes',
  'applied the requested update',
  'implemented the requested changes',
  'implemented the requested update',
  'completed the requested changes',
  'completed the requested update',
  'updated the app definition from the latest chat instruction',
  'applied the latest chat instruction to the app definition',
]);

function normalizeSummaryForMatch(summary: string) {
  return summary.trim().replace(/\s+/g, ' ').toLowerCase().replace(/\.$/, '');
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
