import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Renderer } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@pages/Chat/builder/openui/library';
import { GroupComponent } from '@pages/Chat/builder/openui/library/components/Group';

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

    expect(html).toContain('rounded-xl');
    expect(html).toContain('p-3');
    expect(html).not.toContain('border-slate-200/70');
    expect(html).not.toContain('bg-slate-50/80');
    expect(html).not.toContain('pt-6');
  });

  it('keeps bottom alignment for horizontal inline groups by default', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("main", "Main", [
    Group("Filters", "horizontal", [], "inline")
  ])
])`);

    expect(html).toContain('md:flex-row');
    expect(html).toContain('md:flex-wrap');
    expect(html).toContain('md:items-end');
    expect(html).not.toContain('md:items-start');
  });

  it('keeps bottom alignment for horizontal block groups by default', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("main", "Main", [
    Group("Filters", "horizontal", [])
  ])
])`);

    expect(html).toContain('md:flex-row');
    expect(html).toContain('md:flex-wrap');
    expect(html).toContain('md:items-end');
    expect(html).not.toContain('md:items-start');
  });
});
