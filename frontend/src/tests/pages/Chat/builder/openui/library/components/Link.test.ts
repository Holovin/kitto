import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkComponent } from '@pages/Chat/builder/openui/library/components/Link';
import { parseSafeUrl } from '@pages/Chat/builder/openui/runtime/safeUrl';
import {
  allowedUrlCases,
  rejectedUrlCases,
} from '@src/tests/pages/Chat/builder/openui/runtime/safeUrlTestCases';

function renderLink(props: { label: string; newTab: boolean; url: unknown }) {
  function TestLink() {
    return LinkComponent.component({ props } as never);
  }

  return renderToStaticMarkup(createElement(TestLink));
}

describe('LinkComponent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([...allowedUrlCases, ...rejectedUrlCases])(
    'uses parseSafeUrl to decide whether $label renders as an active anchor',
    ({ label, value }) => {
      const html = renderLink({
        label,
        newTab: false,
        url: value,
      });
      const safeUrl = parseSafeUrl(value);

      if (safeUrl) {
        expect(html).toContain('<a');
        expect(html).toContain(`href="${safeUrl}"`);
        expect(html).not.toContain('target="_blank"');
        expect(html).not.toContain('rel="noopener noreferrer"');
        return;
      }

      expect(html).toContain('<span');
      expect(html).toContain('aria-disabled="true"');
      expect(html).toContain(label);
      expect(html).not.toContain('href=');
    },
  );

  it('rejects javascript: URLs', () => {
    const html = renderLink({
      label: 'Unsafe link',
      newTab: true,
      url: 'javascript:alert(1)',
    });

    expect(html).toContain('<span');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('Unsafe link');
  });

  it('rejects data: URLs', () => {
    const html = renderLink({
      label: 'Unsafe data link',
      newTab: true,
      url: 'data:text/html,<script>alert(1)</script>',
    });

    expect(html).toContain('<span');
    expect(html).toContain('aria-disabled="true"');
  });

  it('rejects blob: URLs', () => {
    const html = renderLink({
      label: 'Unsafe blob link',
      newTab: true,
      url: 'blob:https://example.com/123',
    });

    expect(html).toContain('<span');
    expect(html).toContain('aria-disabled="true"');
  });

  it('accepts https URLs', () => {
    const html = renderLink({
      label: 'Docs',
      newTab: true,
      url: 'https://example.com',
    });

    expect(html).toContain('<a');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('rejects relative app paths', () => {
    const html = renderLink({
      label: 'Chat',
      newTab: false,
      url: '/chat',
    });

    expect(html).toContain('<span');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('Chat');
  });

  it('rejects hash links', () => {
    const html = renderLink({
      label: 'Section',
      newTab: true,
      url: '#section',
    });

    expect(html).toContain('<span');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('Section');
  });
});
