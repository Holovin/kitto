import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const bootstrapState = vi.hoisted(() => ({
  connectionStatus: 'connected' as const,
  configStatus: 'loaded' as 'loaded' | 'loading' | 'failed',
  hasResolvedBootstrap: true,
  model: 'gpt-test',
}));

vi.mock('@features/builder/hooks/useBuilderBootstrap', () => ({
  useBuilderBootstrap: () => bootstrapState,
}));

import { BaseLayout } from '@layouts/BaseLayout';

function renderLayoutAt(path: string) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(
        Routes,
        null,
        createElement(
          Route,
          { element: createElement(BaseLayout) },
          createElement(Route, { index: true, element: createElement('div', null, 'Chat page') }),
          createElement(Route, { path: 'chat', element: createElement('div', null, 'Chat page') }),
          createElement(Route, { path: 'elements', element: createElement('div', null, 'Schema page') }),
        ),
      ),
    ),
  );
}

describe('BaseLayout', () => {
  it('forces the active header link text to white on the chat route', () => {
    const html = renderLayoutAt('/');

    expect(html).toMatch(/<a[^>]+aria-current="page"[^>]+class="[^"]*!text-white[^"]*"[^>]*>Chat<\/a>/i);
  });

  it('forces the active header link text to white on the schemas route', () => {
    const html = renderLayoutAt('/elements');

    expect(html).toMatch(/<a[^>]+aria-current="page"[^>]+class="[^"]*!text-white[^"]*"[^>]*>Schema<\/a>/i);
  });

  it('shows a runtime-config error badge when /api/config failed', () => {
    bootstrapState.configStatus = 'failed';

    const html = renderLayoutAt('/');

    expect(html).toContain('Runtime config: unavailable');

    bootstrapState.configStatus = 'loaded';
  });
});
