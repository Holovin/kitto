export type BuilderStreamTimeoutKind = 'idle' | 'max-duration';

export class BuilderStreamTimeoutError extends Error {
  readonly kind: BuilderStreamTimeoutKind;

  constructor(kind: BuilderStreamTimeoutKind) {
    super(
      kind === 'idle'
        ? 'The generation stream went idle for too long. Please try again.'
        : 'The generation stream exceeded the maximum duration. Please try again.',
    );
    this.name = 'BuilderStreamTimeoutError';
    this.kind = kind;
  }
}

interface BuilderStreamTimeoutManagerOptions {
  abort: () => void;
  idleTimeoutMs: number;
  maxDurationMs: number;
  onTimeout?: (kind: BuilderStreamTimeoutKind) => void;
  shouldAbort?: () => boolean;
}

export function createBuilderStreamTimeoutManager({
  abort,
  idleTimeoutMs,
  maxDurationMs,
  onTimeout,
  shouldAbort,
}: BuilderStreamTimeoutManagerOptions) {
  let idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let maxDurationTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let timeoutError: BuilderStreamTimeoutError | null = null;

  const clearIdleTimeout = () => {
    if (!idleTimeoutId) {
      return;
    }

    clearTimeout(idleTimeoutId);
    idleTimeoutId = null;
  };

  const clearMaxDurationTimeout = () => {
    if (!maxDurationTimeoutId) {
      return;
    }

    clearTimeout(maxDurationTimeoutId);
    maxDurationTimeoutId = null;
  };

  const abortForTimeout = (kind: BuilderStreamTimeoutKind) => {
    if (timeoutError || shouldAbort?.()) {
      return;
    }

    timeoutError = new BuilderStreamTimeoutError(kind);
    onTimeout?.(kind);
    abort();
  };

  return {
    clearTimeouts() {
      clearIdleTimeout();
      clearMaxDurationTimeout();
    },
    getTimeoutError() {
      return timeoutError;
    },
    restartIdleTimeout() {
      if (idleTimeoutMs <= 0) {
        return;
      }

      clearIdleTimeout();
      idleTimeoutId = setTimeout(() => {
        abortForTimeout('idle');
      }, idleTimeoutMs);
    },
    startMaxDurationTimeout() {
      if (maxDurationMs <= 0) {
        return;
      }

      maxDurationTimeoutId = setTimeout(() => {
        abortForTimeout('max-duration');
      }, maxDurationMs);
    },
  };
}
