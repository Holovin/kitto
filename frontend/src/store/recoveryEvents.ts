export interface RecoveryLogEntry {
  kind: 'persistence/dropped';
  reason: string;
  slice: 'builderSession' | 'domain';
}

export function logRecoveryEvent(entry: RecoveryLogEntry) {
  console.warn('[app.recovery]', entry);
}
