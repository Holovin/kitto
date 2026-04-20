import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Renderer } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@features/builder/openui/library';
import { GroupComponent } from '@features/builder/openui/library/components/Group';

function renderOpenUi(source: string) {
  return renderToStaticMarkup(createElement(Renderer, { library: builderOpenUiLibrary, response: source }));
}

describe('GroupComponent', () => {
  it('defaults variant to block', () => {
    const props = GroupComponent.props.parse({
      title: 'Profile',
      direction: 'vertical',
      children: [],
    });
    const html = renderOpenUi(`root = AppShell([
  Screen("main", "Main", [
    Group("Profile", "vertical", [])
  ])
])`);

    expect(props.variant).toBe('block');
    expect(html).toContain('border-slate-200/70');
    expect(html).toContain('bg-slate-50/80');
  });

  it('renders inline variant without the card-like surface', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("main", "Main", [
    Group("Filters", "vertical", [], "inline")
  ])
])`);

    expect(html).not.toContain('border-slate-200/70');
    expect(html).not.toContain('bg-slate-50/80');
    expect(html).not.toContain('pt-6');
  });

  it('keeps horizontal direction classes for inline groups', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("main", "Main", [
    Group("Filters", "horizontal", [], "inline")
  ])
])`);

    expect(html).toContain('md:flex-row');
    expect(html).toContain('md:flex-wrap');
    expect(html).toContain('md:items-end');
  });
});
