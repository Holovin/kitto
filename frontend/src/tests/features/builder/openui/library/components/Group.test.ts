import type { ReactElement, ReactNode } from 'react';
import { Children, isValidElement } from 'react';
import { describe, expect, it } from 'vitest';
import { GroupComponent } from '@features/builder/openui/library/components/Group';

type GroupProps = {
  children?: unknown[];
  direction?: 'horizontal' | 'vertical';
  title?: string | null;
  variant?: 'block' | 'inline';
};

function renderGroup(input: GroupProps = {}) {
  const props = GroupComponent.props.parse({
    title: null,
    direction: 'vertical',
    children: [],
    ...input,
  });
  const element = GroupComponent.component({
    props,
    renderNode: (value: unknown) => value as never,
  } as never);

  expect(isValidElement(element)).toBe(true);

  if (!isValidElement(element)) {
    throw new Error('Group component did not return a valid React element.');
  }

  return {
    element: element as ReactElement<Record<string, unknown>>,
    props,
  };
}

function getContentElement(element: ReactElement<Record<string, unknown>>) {
  const children = Children.toArray(element.props.children as ReactNode).filter(
    (child): child is ReactElement<Record<string, unknown>> => isValidElement(child),
  );
  const contentElement = children.at(-1);

  expect(contentElement).toBeDefined();

  if (!contentElement) {
    throw new Error('Expected Group to render a content wrapper.');
  }

  return contentElement;
}

function getClassName(element: ReactElement<Record<string, unknown>>) {
  return String(element.props.className ?? '');
}

describe('GroupComponent', () => {
  it('defaults variant to block', () => {
    const { element, props } = renderGroup({
      title: 'Profile',
    });

    expect(props.variant).toBe('block');
    expect(getClassName(element)).toContain('border-slate-200/70');
    expect(getClassName(element)).toContain('bg-slate-50/80');
  });

  it('renders inline variant without the card-like surface', () => {
    const { element } = renderGroup({
      title: 'Filters',
      variant: 'inline',
    });

    expect(element.type).toBe('div');
    expect(getClassName(element)).not.toContain('border-slate-200/70');
    expect(getClassName(element)).not.toContain('bg-slate-50/80');

    const contentElement = getContentElement(element);

    expect(getClassName(contentElement)).not.toContain('pt-6');
  });

  it('keeps horizontal direction classes for inline groups', () => {
    const { element } = renderGroup({
      direction: 'horizontal',
      variant: 'inline',
    });

    const contentElement = getContentElement(element);

    expect(getClassName(contentElement)).toContain('md:flex-row');
    expect(getClassName(contentElement)).toContain('md:flex-wrap');
    expect(getClassName(contentElement)).toContain('md:items-end');
  });
});
