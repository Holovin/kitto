import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Renderer } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@features/builder/openui/library';
import { getValidationFeedback } from '@features/builder/openui/library/components/shared';

vi.mock('@features/builder/openui/library/components/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@features/builder/openui/library/components/shared')>();

  return {
    ...actual,
    getValidationFeedback: vi.fn(actual.getValidationFeedback),
  };
});

const mockedGetValidationFeedback = vi.mocked(getValidationFeedback);

function renderOpenUi(source: string) {
  return renderToStaticMarkup(createElement(Renderer, { library: builderOpenUiLibrary, response: source }));
}

describe('OpenUI validation UI', () => {
  afterEach(() => {
    mockedGetValidationFeedback.mockReset();
  });

  it.each([
    [
      'Input',
      `$name = ""
root = AppShell([
  Screen("main", "Main", [
    Input("name", "Name", $name, "Ada", "Helpful copy", "text", [{ type: "required", message: "Name is required" }])
  ])
])`,
    ],
    [
      'TextArea',
      `$notes = ""
root = AppShell([
  Screen("main", "Main", [
    TextArea("notes", "Notes", $notes, "Write more", "Helpful copy", [{ type: "required", message: "Notes are required" }])
  ])
])`,
    ],
    [
      'Checkbox',
      `$accepted = false
root = AppShell([
  Screen("main", "Main", [
    Checkbox("accepted", "Accept", $accepted, "Helpful copy", [{ type: "required", message: "Accept first" }])
  ])
])`,
    ],
    [
      'RadioGroup',
      `$plan = ""
planOptions = [
  { label: "Starter", value: "starter" },
  { label: "Pro", value: "pro" }
]
root = AppShell([
  Screen("main", "Main", [
    RadioGroup("plan", "Plan", $plan, planOptions, "Helpful copy", [{ type: "required", message: "Pick one" }])
  ])
])`,
    ],
    [
      'Select',
      `$plan = ""
planOptions = [
  { label: "Starter", value: "starter" },
  { label: "Pro", value: "pro" }
]
root = AppShell([
  Screen("main", "Main", [
    Select("plan", "Plan", $plan, planOptions, "Helpful copy", [{ type: "required", message: "Pick one" }])
  ])
])`,
    ],
  ])('renders helper text without alert semantics for %s', (_componentName, source) => {
    mockedGetValidationFeedback.mockReturnValue({
      hasVisibleError: false,
      helperText: 'Helpful copy',
      validationError: undefined,
    });

    const html = renderOpenUi(source);

    expect(html).toContain('Helpful copy');
    expect(html).toContain('aria-describedby=');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('text-rose-600');
  });

  it.each([
    [
      'Input',
      `$name = ""
root = AppShell([
  Screen("main", "Main", [
    Input("name", "Name", $name, "Ada", null, "text", [{ type: "required", message: "Name is required" }])
  ])
])`,
      'border-rose-400 focus-visible:border-rose-500',
    ],
    [
      'TextArea',
      `$notes = ""
root = AppShell([
  Screen("main", "Main", [
    TextArea("notes", "Notes", $notes, "Write more", null, [{ type: "required", message: "Notes are required" }])
  ])
])`,
      'border-rose-400 focus-visible:border-rose-500',
    ],
    [
      'Checkbox',
      `$accepted = false
root = AppShell([
  Screen("main", "Main", [
    Checkbox("accepted", "Accept", $accepted, null, [{ type: "required", message: "Accept first" }])
  ])
])`,
      'border-rose-400 focus-visible:border-rose-500',
    ],
    [
      'RadioGroup',
      `$plan = ""
planOptions = [
  { label: "Starter", value: "starter" },
  { label: "Pro", value: "pro" }
]
root = AppShell([
  Screen("main", "Main", [
    RadioGroup("plan", "Plan", $plan, planOptions, null, [{ type: "required", message: "Pick one" }])
  ])
])`,
      'border-rose-400 focus-visible:border-rose-500',
    ],
    [
      'Select',
      `$plan = ""
planOptions = [
  { label: "Starter", value: "starter" },
  { label: "Pro", value: "pro" }
]
root = AppShell([
  Screen("main", "Main", [
    Select("plan", "Plan", $plan, planOptions, null, [{ type: "required", message: "Pick one" }])
  ])
])`,
      'border-rose-400 focus-visible:border-rose-500',
    ],
  ])('marks %s invalid without rendering inline error text', (_componentName, source, errorClassName) => {
    mockedGetValidationFeedback.mockReturnValue({
      hasVisibleError: true,
      helperText: undefined,
      validationError: 'Inline error should stay hidden',
    });

    const html = renderOpenUi(source);

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain(errorClassName);
    expect(html).not.toContain('Inline error should stay hidden');
    expect(html).not.toContain('role="alert"');
  });
});
