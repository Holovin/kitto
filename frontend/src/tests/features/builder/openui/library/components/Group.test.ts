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

  it('adds a targeted offset hook for buttons that follow stacked fields', () => {
    const html = renderOpenUi(`$draft = ""

root = AppShell([
  Screen("main", "Main", [
    Group("Add task", "horizontal", [
      Input("draft", "Task", $draft, "New task"),
      Button("add-task", "Add", "default", Action([]), false)
    ], "inline")
  ])
])`);

    expect(html).toContain('data-kitto-stacked-field="true"');
    expect(html).toContain('data-kitto-button="true"');
    expect(html).toContain('[&amp;&gt;[data-kitto-stacked-field]~[data-kitto-button]]:mt-[1.75rem]');
    expect(html).toContain('[&amp;&gt;[data-kitto-stacked-field]~[data-kitto-button]]:self-start');
  });
});
