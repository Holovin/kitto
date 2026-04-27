import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';
import type { StateField } from '@openuidev/react-lang';
import type { OpenUiAction } from '@pages/Chat/builder/openui/library/components/shared';

const testHarness = vi.hoisted(() => ({
  markSubmitLikeInteraction: vi.fn(),
  triggerAction: vi.fn(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');

  return {
    ...actual,
    useContext: () => ({
      getRegisteredFieldNames: () => [],
      hasContrastColor: false,
      hasMainColor: false,
      markSubmitLikeInteraction: testHarness.markSubmitLikeInteraction,
      registerFieldName: () => () => undefined,
    }),
  };
});

vi.mock('@components/ui/button', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');

  return {
    Button: (props: Record<string, unknown>) => actual.createElement('button', props),
  };
});

vi.mock('@openuidev/react-lang', () => ({
  defineComponent: (config: unknown) => config,
  reactive: (schema: unknown) => schema,
  useIsStreaming: () => false,
  useStateField: (_name: string, value?: unknown) => ({ value }),
  useTriggerAction: () => testHarness.triggerAction,
}));

import { ButtonComponent } from '@pages/Chat/builder/openui/library/components/Button';

describe('ButtonComponent action events', () => {
  beforeEach(() => {
    testHarness.markSubmitLikeInteraction.mockReset();
    testHarness.triggerAction.mockReset();
  });

  it('passes the visible label to useTriggerAction as the human-friendly action message', () => {
    const action = { steps: [] } satisfies OpenUiAction;
    const disabledField = {
      isReactive: false,
      name: '__button_disabled__:archive-primary',
      setValue: vi.fn(),
      value: false,
    } satisfies StateField<boolean>;
    const element = ButtonComponent.component({
      props: {
        action,
        disabled: disabledField,
        id: 'archive-primary',
        label: 'Archive',
        variant: 'default',
      },
      renderNode: (value: unknown) => value as never,
    });

    if (!isValidElement<{ onClick: () => void }>(element)) {
      throw new Error('Expected ButtonComponent to render a button element.');
    }

    element.props.onClick();

    expect(testHarness.triggerAction).toHaveBeenCalledWith('Archive', undefined, action);
    expect(testHarness.triggerAction).not.toHaveBeenCalledWith('archive-primary', undefined, action);
  });
});
