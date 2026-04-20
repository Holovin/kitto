import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Renderer } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@features/builder/openui/library';
import { InputComponent } from '@features/builder/openui/library/components/Input';
import { validateOpenUiSource } from '@features/builder/openui/runtime/validation';

function renderOpenUi(source: string) {
  return renderToStaticMarkup(createElement(Renderer, { library: builderOpenUiLibrary, response: source }));
}

describe('InputComponent', () => {
  it('defaults the input type to text', () => {
    const html = renderOpenUi(`$name = ""
root = AppShell([
  Screen("main", "Main", [
    Input("name", "Name", $name, "Ada Lovelace")
  ])
])`);

    expect(html).toContain('type="text"');
  });

  it.each([
    ['date', '2026-04-25'],
    ['number', '12'],
    ['email', 'ada@example.com'],
    ['time', '09:30'],
    ['password', 'secret-123'],
  ] as const)('renders input[type=%s]', (inputType, value) => {
    const props = InputComponent.props.parse({
      label: 'Field',
      name: 'field',
      placeholder: '',
      type: inputType,
      value,
    });
    const html = renderOpenUi(`$value = "${value}"
root = AppShell([
  Screen("main", "Main", [
    Input("field", "Field", $value, "", null, "${inputType}")
  ])
])`);

    expect(props.value).toBe(value);
    expect(html).toContain(`type="${inputType}"`);
  });

  it('keeps date values as YYYY-MM-DD strings', () => {
    const props = InputComponent.props.parse({
      helper: 'Pick a due date',
      label: 'Due date',
      name: 'dueDate',
      placeholder: '',
      type: 'date',
      validation: [{ message: 'Choose a due date', type: 'required' }],
      value: '2026-04-25',
    });
    const html = renderOpenUi(`$dueDate = "2026-04-25"
root = AppShell([
  Screen("main", "Main", [
    Input("dueDate", "Due date", $dueDate, "", "Pick a due date", "date", [
      { type: "required", message: "Choose a due date" }
    ])
  ])
])`);

    expect(props.value).toBe('2026-04-25');
    expect(typeof props.value).toBe('string');
    expect(html).toContain('type="date"');
    expect(html).not.toContain('2026-04-25T');
  });

  it('rejects invalid input types', () => {
    const result = validateOpenUiSource(`$field = ""
root = AppShell([
  Screen("main", "Main", [
    Input("field", "Field", $field, "", null, "search")
  ])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-prop',
          message: 'Input.type must be one of "text", "email", "number", "date", "time", "password".',
        }),
      ]),
    );
  });
});
