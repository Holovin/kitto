import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Renderer } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@features/builder/openui/library';

function renderOpenUi(source: string) {
  return renderToStaticMarkup(createElement(Renderer, { library: builderOpenUiLibrary, response: source }));
}

describe('AppShellComponent', () => {
  it('falls back to the first screen when every screen resolves inactive', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("quiz", "Quiz", [], false),
  Screen("results", "Results", [], false)
])`);

    expect(html).toContain('data-screen="quiz"');
    expect(html).toContain('Quiz');
    expect(html).not.toContain('data-screen="results"');
    expect(html).not.toContain('Results');
  });

  it('keeps the existing active-screen selection when one screen is active', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("quiz", "Quiz", [], false),
  Screen("results", "Results", [], true)
])`);

    expect(html).not.toContain('data-screen="quiz"');
    expect(html).toContain('data-screen="results"');
    expect(html).toContain('Results');
  });
});
