import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Renderer } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@features/builder/openui/library';

function renderOpenUi(source: string) {
  return renderToStaticMarkup(createElement(Renderer, { library: builderOpenUiLibrary, response: source }));
}

describe('OpenUI form field attributes', () => {
  it('renders id, name, and default autocomplete for text inputs', () => {
    const html = renderOpenUi(`$title = ""
root = AppShell([
  Screen("main", "Main", [
    Input("title", "Title", $title, "Write a title")
  ])
])`);

    expect(html).toContain('id="title"');
    expect(html).toContain('name="title"');
    expect(html).toContain('autoComplete="off"');
  });

  it('renders id, name, and autocomplete for text areas', () => {
    const html = renderOpenUi(`$notes = ""
root = AppShell([
  Screen("main", "Main", [
    TextArea("notes", "Notes", $notes, "Write more")
  ])
])`);

    expect(html).toContain('id="notes"');
    expect(html).toContain('name="notes"');
    expect(html).toContain('autoComplete="off"');
  });

  it('renders native checkbox and radio inputs with form names', () => {
    const html = renderOpenUi(`$accepted = false
$plan = ""
planOptions = [
  { label: "Starter", value: "starter" },
  { label: "Pro", value: "pro" }
]
root = AppShell([
  Screen("main", "Main", [
    Checkbox("accepted", "Accept", $accepted),
    RadioGroup("plan", "Plan", $plan, planOptions)
  ])
])`);

    expect(html).toContain('type="checkbox"');
    expect(html).toContain('name="accepted"');
    expect(html).toContain('type="radio"');
    expect(html).toContain('name="plan"');
  });

  it('renders the hidden native select with name and autocomplete', () => {
    const html = renderOpenUi(`$plan = ""
planOptions = [
  { label: "Starter", value: "starter" },
  { label: "Pro", value: "pro" }
]
root = AppShell([
  Screen("main", "Main", [
    Select("plan", "Plan", $plan, planOptions)
  ])
])`);

    expect(html).toContain('<select');
    expect(html).toContain('name="plan"');
    expect(html).toContain('autoComplete="off"');
  });
});
