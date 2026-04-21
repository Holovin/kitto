import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Renderer } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@features/builder/openui/library';
import { ButtonComponent } from '@features/builder/openui/library/components/Button';
import { InputComponent } from '@features/builder/openui/library/components/Input';
import { ScreenComponent } from '@features/builder/openui/library/components/Screen';
import { SelectComponent } from '@features/builder/openui/library/components/Select';
import { TextComponent } from '@features/builder/openui/library/components/Text';

function renderOpenUi(source: string) {
  return renderToStaticMarkup(createElement(Renderer, { library: builderOpenUiLibrary, response: source }));
}

describe('OpenUI appearance inheritance', () => {
  it('lets AppShell define inherited CSS variables', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ])
], { mainColor: "#111827", contrastColor: "#F9FAFB" })`);

    expect(html).toMatch(/data-app-shell="true"/i);
    expect(html).toMatch(/--kitto-main-color:#111827/i);
    expect(html).toMatch(/--kitto-contrast-color:#F9FAFB/i);
  });

  it('lets Screen override inherited colors for its subtree', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ], true, { mainColor: "#0F172A", contrastColor: "#F9FAFB" })
], { mainColor: "#FFFFFF", contrastColor: "#111827" })`);

    expect(html).toMatch(/data-screen="main"[^>]+--kitto-main-color:#0F172A/i);
    expect(html).toMatch(/data-screen="main"[^>]+--kitto-contrast-color:#F9FAFB/i);
    expect(html).toMatch(/data-screen="main"[^>]+background-color:var\(--kitto-main-color\)/i);
  });

  it('lets Group override inherited colors for nested content', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("main", "Main", [
    Group("Welcome", "vertical", [
      Text("This is a dark interface.", "body", "start")
    ], "block", { mainColor: "#111827", contrastColor: "#F9FAFB" })
  ])
])`);

    expect(html).toMatch(/--kitto-main-color:#111827/i);
    expect(html).toMatch(/--kitto-contrast-color:#F9FAFB/i);
    expect(html).toMatch(/background-color:var\(--kitto-main-color\)/i);
  });

  it('keeps Repeater empty states on the inherited theme surface', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("main", "Main", [
    Repeater([], "Nothing to show yet.")
  ])
], { mainColor: "#111827", contrastColor: "#F9FAFB" })`);

    expect(html).toContain('Nothing to show yet.');
    expect(html).toMatch(/Nothing to show yet\.<\/div><\/div>/i);
    expect(html).toMatch(/color:var\(--kitto-contrast-color\)/i);
    expect(html).toMatch(/background-color:var\(--kitto-main-color\)/i);
  });

  it('lets shared-theme controls inherit AppShell colors and applies the same button appearance mapping across variants', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("main", "Main", [
    Input("todoText", "New todo", $todoText, "What needs to be done?"),
    Select("filter", "Filter", $filter, [
      { label: "All", value: "all" },
      { label: "Active", value: "active" }
    ]),
    Button("submit-button", "Submit", "default", Action([]), false),
    Button("cancel-button", "Cancel", "secondary", Action([]), false),
    Button("delete-button", "Delete", "destructive", Action([]), false),
    Link("Docs", "https://example.com", true)
  ])
], { mainColor: "#111827", contrastColor: "#F9FAFB" })

$todoText = ""
$filter = "all"`);

    expect(html).toMatch(/input[^>]+color:var\(--kitto-contrast-color\);background-color:var\(--kitto-main-color\)/i);
    expect(html).toMatch(
      /<button[^>]+role="combobox"[^>]+style="(?=[^"]*background-color:var\(--kitto-main-color\))(?=[^"]*color:var\(--kitto-contrast-color\))[^"]*"/i,
    );
    expect(html).toMatch(/<button[^>]+style="[^"]*background-color:var\(--kitto-main-color\)[^"]*"[^>]*><span style="color:var\(--kitto-contrast-color\)">Submit<\/span><\/button>/i);
    expect(html).toMatch(/<button[^>]+style="[^"]*background-color:var\(--kitto-main-color\)[^"]*"[^>]*><span style="color:var\(--kitto-contrast-color\)">Cancel<\/span><\/button>/i);
    expect(html).toMatch(/<button[^>]+style="[^"]*background-color:var\(--kitto-main-color\)[^"]*"[^>]*><span style="color:var\(--kitto-contrast-color\)">Delete<\/span><\/button>/i);
    expect(html).toMatch(/<a[^>]+href="https:\/\/example.com"[^>]+color:var\(--kitto-contrast-color\);background-color:var\(--kitto-main-color\)/i);
  });

  it('lets local appearance override inherited colors', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("main", "Main", [
    Button("publish", "Publish", "default", Action([]), false, { mainColor: "#2563EB", contrastColor: "#FFFFFF" })
  ])
], { mainColor: "#111827", contrastColor: "#FFFFFF" })`);

    expect(html).toMatch(/--kitto-main-color:#2563EB/i);
    expect(html).toMatch(/--kitto-contrast-color:#FFFFFF/i);
    expect(html).toMatch(/background-color:var\(--kitto-main-color\)/i);
    expect(html).toMatch(/<span style="[^"]*color:var\(--kitto-contrast-color\)[^"]*">Publish<\/span>/i);
  });

  it('accepts appearance props on supported components and rejects mainColor on Text', () => {
    const appearance = {
      mainColor: '#111827',
      contrastColor: '#F9FAFB',
    };

    expect(ScreenComponent.props.safeParse({ id: 'main', title: 'Main', children: [], isActive: true, appearance }).success).toBe(true);
    expect(InputComponent.props.safeParse({ name: 'name', label: 'Name', value: 'Ada', placeholder: 'Ada', appearance }).success).toBe(true);
    expect(
      SelectComponent.props.safeParse({
        name: 'frequency',
        label: 'Frequency',
        value: 'weekly',
        options: [{ label: 'Weekly', value: 'weekly' }],
        appearance,
      }).success,
    ).toBe(true);
    expect(ButtonComponent.props.safeParse({ id: 'save', label: 'Save', variant: 'default', disabled: false, appearance }).success).toBe(true);
    expect(TextComponent.props.safeParse({ value: 'Hello', variant: 'body', align: 'start', appearance: { contrastColor: '#F9FAFB' } }).success).toBe(true);
    expect(TextComponent.props.safeParse({ value: 'Hello', variant: 'body', align: 'start', appearance }).success).toBe(false);
  });
});
