import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Renderer } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@pages/Chat/builder/openui/library';

function renderOpenUi(source: string) {
  return renderToStaticMarkup(createElement(Renderer, { library: builderOpenUiLibrary, response: source }));
}

describe('AppShellComponent', () => {
  it('shows an empty-content overlay when every screen resolves inactive', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("quiz", "Quiz", [], false),
  Screen("results", "Results", [], false)
])`);

    expect(html).toContain('data-empty-initial-render="true"');
    expect(html).toContain('The generated app currently has no visible content.');
    expect(html).not.toContain('data-screen="quiz"');
    expect(html).not.toContain('Quiz');
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
    expect(html).not.toContain('data-empty-initial-render="true"');
  });

  it('does not show the empty-content overlay when multiple screens are always visible', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("quiz", "Quiz", []),
  Screen("results", "Results", [])
])`);

    expect(html).toContain('data-screen="quiz"');
    expect(html).toContain('data-screen="results"');
    expect(html).not.toContain('data-empty-initial-render="true"');
  });
});
