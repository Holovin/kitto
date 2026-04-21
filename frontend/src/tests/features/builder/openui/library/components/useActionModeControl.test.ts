import { beforeEach, describe, expect, it, vi } from 'vitest';

const testHarness = vi.hoisted(() => {
  class HookRuntime {
    cursor = 0;
    hookValues: unknown[] = [];

    render<Result>(callback: () => Result) {
      activeRuntimeRef.current = this;
      this.cursor = 0;

      try {
        return callback();
      } finally {
        activeRuntimeRef.current = null;
      }
    }

    useRef<Value>(initialValue: Value) {
      const index = this.cursor;
      this.cursor += 1;

      if (!(index in this.hookValues)) {
        this.hookValues[index] = { current: initialValue };
      }

      return this.hookValues[index] as { current: Value };
    }

    useState<Value>(initialValue: Value) {
      const index = this.cursor;
      this.cursor += 1;

      if (!(index in this.hookValues)) {
        this.hookValues[index] = initialValue;
      }

      const setValue = (nextValue: Value | ((previousValue: Value) => Value)) => {
        const previousValue = this.hookValues[index] as Value;
        this.hookValues[index] =
          typeof nextValue === 'function' ? (nextValue as (previousValue: Value) => Value)(previousValue) : nextValue;
      };

      return [this.hookValues[index] as Value, setValue] as const;
    }
  }

  const activeRuntimeRef = {
    current: null as HookRuntime | null,
  };

  return {
    HookRuntime,
    activeRuntimeRef,
    isStreaming: false,
    triggerAction: vi.fn(),
  };
});

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');

  function getRuntime() {
    const runtime = testHarness.activeRuntimeRef.current;

    if (!runtime) {
      throw new Error('Hook called outside of the test hook runtime.');
    }

    return runtime;
  }

  return {
    ...actual,
    useRef: <Value>(initialValue: Value) => getRuntime().useRef(initialValue),
    useState: <Value>(initialValue: Value) => getRuntime().useState(initialValue),
  };
});

vi.mock('@openuidev/react-lang', () => ({
  useIsStreaming: () => testHarness.isStreaming,
  useTriggerAction: () => testHarness.triggerAction,
}));

import { useActionModeControl } from '@features/builder/openui/library/components/useActionModeControl';

function renderActionModeControl<Value>(options: {
  action?: unknown;
  beforeRun?: (nextValue: Value) => void;
  name: string;
  queue: 'checkbox' | 'choice';
}) {
  const runtime = new testHarness.HookRuntime();

  return runtime.render(() => useActionModeControl(options));
}

describe('useActionModeControl', () => {
  beforeEach(() => {
    testHarness.isStreaming = false;
    testHarness.triggerAction.mockReset();
  });

  it('processes 5 rapid choice actions sequentially without racing beforeRun state', async () => {
    const values = ['starter', 'pro', 'enterprise', 'team', 'custom'];
    const seenChoices: string[] = [];
    const seenNames: string[] = [];
    let currentChoice = '';
    let activeCount = 0;
    let maxActiveCount = 0;

    testHarness.triggerAction.mockImplementation(async (name: string) => {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      seenNames.push(name);
      seenChoices.push(currentChoice);
      await Promise.resolve();
      activeCount -= 1;
    });

    const controls = values.map((_, index) =>
      renderActionModeControl<string>({
        action: { type: 'Action' },
        beforeRun: (nextValue) => {
          currentChoice = nextValue;
        },
        name: `choice-${index + 1}`,
        queue: 'choice',
      }),
    );

    await Promise.all(controls.map((control, index) => control.runAction(values[index])));

    expect(testHarness.triggerAction).toHaveBeenCalledTimes(5);
    expect(seenNames).toEqual(['choice-1', 'choice-2', 'choice-3', 'choice-4', 'choice-5']);
    expect(seenChoices).toEqual(values);
    expect(maxActiveCount).toBe(1);
  });
});
