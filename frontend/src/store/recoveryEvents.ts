export interface RecoveryLogEntry {
  kind: 'persistence/dropped' | 'persistence/quota-trimmed';
  reason: string;
  slice: 'builder' | 'builderSession' | 'domain';
}

export function logRecoveryEvent(entry: RecoveryLogEntry) {
  console.warn('[app.recovery]', entry);
}
