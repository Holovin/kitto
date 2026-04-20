import type { ReactElement } from 'react';
import { isValidElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkComponent } from '@features/builder/openui/library/components/Link';
import { parseSafeUrl } from '@features/builder/openui/runtime/safeUrl';
import {
  allowedUrlCases,
  rejectedUrlCases,
} from '@src/tests/features/builder/openui/runtime/safeUrlTestCases';

function renderLink(props: { label: string; newTab: boolean; url: unknown }) {
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

  it.each([...allowedUrlCases, ...rejectedUrlCases])(
    'uses parseSafeUrl to decide whether $label renders as an active anchor',
    ({ label, value }) => {
      let element: ReactElement<Record<string, unknown>> | undefined;

      expect(() => {
        element = renderLink({
          label,
          newTab: false,
          url: value,
        });
      }).not.toThrow();

      if (!element) {
        throw new Error('Link component did not return a React element.');
      }

      const safeUrl = parseSafeUrl(value);

      if (safeUrl) {
        expect(element.type).toBe('a');
        expect(element.props.href).toBe(safeUrl);
        expect(element.props.target).toBeUndefined();
        expect(element.props.rel).toBeUndefined();
        return;
      }

      expect(element.type).toBe('span');
      expect(element.props['aria-disabled']).toBe('true');
      expect(element.props.href).toBeUndefined();
      expect(element.props.children).toBe(label);
    },
  );

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
      label: 'Section',
      newTab: true,
      url: '#section',
    });

    expect(element.type).toBe('span');
    expect(element.props['aria-disabled']).toBe('true');
    expect(element.props.children).toBe('Section');
  });
});
