import type { ReactElement } from 'react';
import { isValidElement } from 'react';
import { describe, expect, it } from 'vitest';
import { RepeaterComponent } from '@features/builder/openui/library/components/Repeater';

function renderRepeater(input: { children?: unknown[]; emptyText?: string | null } = {}) {
  const props = RepeaterComponent.props.parse({
    children: [],
    emptyText: 'Nothing to show yet.',
    ...input,
  });
  const element = RepeaterComponent.component({
    props,
    renderNode: (value: unknown) => value as never,
  } as never);

  expect(isValidElement(element)).toBe(true);

  if (!isValidElement(element)) {
    throw new Error('Repeater component did not return a valid React element.');
  }

  return element as ReactElement<Record<string, unknown>>;
}

describe('RepeaterComponent', () => {
  it('keeps the same outer layout wrapper for empty states without forcing a white surface', () => {
    const element = renderRepeater();

    expect(String(element.props.className ?? '')).toContain('flex');
    expect(String(element.props.className ?? '')).toContain('gap-3');

    const placeholder = element.props.children as ReactElement<Record<string, unknown>>;

    expect(String(placeholder.props.className ?? '')).not.toContain('bg-white');
    expect(String(placeholder.props.className ?? '')).not.toContain('border');
    expect(String(placeholder.props.className ?? '')).not.toContain('px-');
    expect(String(placeholder.props.className ?? '')).not.toContain('py-');
    expect(String(placeholder.props.children ?? '')).toContain('Nothing to show yet.');
  });
});
