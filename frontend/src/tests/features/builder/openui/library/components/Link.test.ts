import type { ReactElement } from 'react';
import { isValidElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkComponent } from '@features/builder/openui/library/components/Link';

function renderLink(props: { label: string; newTab: boolean; url: string }) {
  const element = LinkComponent.component({ props } as never);

  expect(isValidElement(element)).toBe(true);

  if (!isValidElement(element)) {
    throw new Error('Link component did not return a valid React element.');
  }

  return element as ReactElement<Record<string, unknown>>;
}

describe('LinkComponent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects javascript: URLs', () => {
    const element = renderLink({
      label: 'Unsafe link',
      newTab: true,
      url: 'javascript:alert(1)',
    });

    expect(element.type).toBe('span');
    expect(element.props['aria-disabled']).toBe('true');
    expect(element.props.children).toBe('Unsafe link');
  });

  it('rejects data: URLs', () => {
    const element = renderLink({
      label: 'Unsafe data link',
      newTab: true,
      url: 'data:text/html,<script>alert(1)</script>',
    });

    expect(element.type).toBe('span');
    expect(element.props['aria-disabled']).toBe('true');
  });

  it('rejects blob: URLs', () => {
    const element = renderLink({
      label: 'Unsafe blob link',
      newTab: true,
      url: 'blob:https://example.com/123',
    });

    expect(element.type).toBe('span');
    expect(element.props['aria-disabled']).toBe('true');
  });

  it('accepts https URLs', () => {
    const element = renderLink({
      label: 'Docs',
      newTab: true,
      url: 'https://example.com',
    });

    expect(element.type).toBe('a');
    expect(element.props.href).toBe('https://example.com');
    expect(element.props.target).toBe('_blank');
    expect(element.props.rel).toBe('noopener noreferrer');
  });

  it('accepts relative app paths', () => {
    const element = renderLink({
      label: 'Chat',
      newTab: false,
      url: '/chat',
    });

    expect(element.type).toBe('a');
    expect(element.props.href).toBe('/chat');
    expect(element.props.target).toBeUndefined();
  });

  it('renders relative app paths as inert text when opened from file protocol', () => {
    vi.stubGlobal('location', { protocol: 'file:' });

    const element = renderLink({
      label: 'Chat',
      newTab: false,
      url: '/chat',
    });

    expect(element.type).toBe('span');
    expect(element.props['aria-disabled']).toBe('true');
    expect(element.props.children).toBe('Chat');
  });

  it('renders hash links as inert text when opened from file protocol', () => {
    vi.stubGlobal('location', { protocol: 'file:' });

    const element = renderLink({
      label: 'Details',
      newTab: true,
      url: '#details',
    });

    expect(element.type).toBe('span');
    expect(element.props['aria-disabled']).toBe('true');
    expect(element.props.children).toBe('Details');
  });
});
