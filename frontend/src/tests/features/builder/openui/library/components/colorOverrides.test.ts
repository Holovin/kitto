import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Renderer } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@features/builder/openui/library';
import { ButtonComponent } from '@features/builder/openui/library/components/Button';
import { CheckboxComponent } from '@features/builder/openui/library/components/Checkbox';
import { InputComponent } from '@features/builder/openui/library/components/Input';
import { RadioGroupComponent } from '@features/builder/openui/library/components/RadioGroup';
import { ScreenComponent } from '@features/builder/openui/library/components/Screen';
import { SelectComponent } from '@features/builder/openui/library/components/Select';
import { TextAreaComponent } from '@features/builder/openui/library/components/TextArea';

function renderOpenUi(source: string) {
  return renderToStaticMarkup(createElement(Renderer, { library: builderOpenUiLibrary, response: source }));
}

describe('OpenUI safe color overrides', () => {
  it('applies Text color safely', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("main", "Main", [
    Text("Please complete all fields.", "body", "start", "#92400E")
  ])
])`);

    expect(html).toMatch(/color:#92400E/i);
  });

  it('applies Screen title color and background safely', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ], true, "#F9FAFB", "#111827")
])`);

    expect(html).toMatch(/data-screen="main"/i);
    expect(html).toMatch(/<h3[^>]+style="color:#F9FAFB"/i);
    expect(html).toMatch(/background-color:#111827/i);
  });

  it('applies Group color/background safely', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("main", "Main", [
    Group("Welcome", "vertical", [
      Text("This is a dark interface.", "body", "start", "#F9FAFB")
    ], "block", "#F9FAFB", "#111827")
  ])
])`);

    expect(html).toMatch(/background-color:#111827/i);
    expect(html).toMatch(/color:#F9FAFB/i);
  });

  it('applies control-level color/background to input-like surfaces', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("main", "Main", [
    Input("todoText", "New todo", $todoText, "What needs to be done?", "#F9FAFB", "#111827"),
    Checkbox("accepted", "Accepted", false, "#F9FAFB", "#111827"),
    RadioGroup("filter", "Show", $filter, [
      { label: "All", value: "all" },
      { label: "Active", value: "active" }
    ], "#F9FAFB", "#111827")
  ])
])

$todoText = ""
$filter = "all"`);

    expect(html).toMatch(/input[^>]+style="color:#F9FAFB;background-color:#111827/i);
    expect(html).toMatch(/label[^>]+style="color:#F9FAFB;background-color:#111827/i);
    expect(html).toMatch(/role="checkbox"[^>]+style="color:#F9FAFB;background-color:#111827/i);
    expect(html).toMatch(/button[^>]+role="radio"[^>]+style="color:#F9FAFB;background-color:#111827/i);
  });

  it('applies Button color/background safely', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("main", "Main", [
    Button("submit-button", "Submit", "default", Action([]), false, "#FFFFFF", "#2563EB")
  ])
])`);

    expect(html).toMatch(/background-color:#2563EB/i);
    expect(html).toMatch(/color:#FFFFFF/i);
  });

  it('input-like components accept valid hex props', () => {
    const colorProps = {
      background: '#FFFFFF',
      color: '#000000',
    };

    expect(ScreenComponent.props.safeParse({ id: 'main', title: 'Main', children: [], isActive: true, ...colorProps }).success).toBe(true);
    expect(InputComponent.props.safeParse({ name: 'name', label: 'Name', value: 'Ada', placeholder: 'Ada', ...colorProps }).success).toBe(true);
    expect(TextAreaComponent.props.safeParse({ name: 'notes', label: 'Notes', value: 'Hello', placeholder: 'Type here', ...colorProps }).success).toBe(
      true,
    );
    expect(CheckboxComponent.props.safeParse({ name: 'accepted', label: 'Accepted', checked: false, ...colorProps }).success).toBe(true);
    expect(
      RadioGroupComponent.props.safeParse({
        name: 'plan',
        label: 'Plan',
        value: 'starter',
        options: [{ label: 'Starter', value: 'starter' }],
        ...colorProps,
      }).success,
    ).toBe(true);
    expect(
      SelectComponent.props.safeParse({
        name: 'frequency',
        label: 'Frequency',
        value: 'weekly',
        options: [{ label: 'Weekly', value: 'weekly' }],
        ...colorProps,
      }).success,
    ).toBe(true);
    expect(ButtonComponent.props.safeParse({ id: 'save', label: 'Save', variant: 'default', disabled: false, ...colorProps }).success).toBe(true);
  });
});
