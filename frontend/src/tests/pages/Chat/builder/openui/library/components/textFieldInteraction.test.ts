import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const textFieldHarness = vi.hoisted(() => ({
  onBlur: vi.fn(),
  setValue: vi.fn(),
}));

vi.mock('@openuidev/react-lang', () => ({
  defineComponent: (definition: unknown) => definition,
  reactive: (schema: unknown) => schema,
  useIsStreaming: () => false,
  useStateField: () => ({
    setValue: textFieldHarness.setValue,
    value: '',
  }),
}));

vi.mock('@components/ui/input', () => ({
  Input: (props: unknown) => props,
}));

vi.mock('@components/ui/textarea', () => ({
  Textarea: (props: unknown) => props,
}));

vi.mock('@pages/Chat/builder/openui/library/components/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pages/Chat/builder/openui/library/components/shared')>();

  return {
    ...actual,
    useKittoAppearanceScope: () => ({
      hasContrastColor: false,
      hasMainColor: false,
    }),
  };
});

vi.mock('@pages/Chat/builder/openui/library/components/useFormFieldValidation', () => ({
  useFormFieldValidation: () => ({
    ariaProps: {
      'aria-invalid': false,
    },
    hasVisibleError: false,
    helperText: undefined,
    onBlur: textFieldHarness.onBlur,
    rules: [],
  }),
}));

function getComponentRenderer(component: unknown) {
  const renderer = (component as { component?: unknown }).component;

  if (typeof renderer !== 'function') {
    throw new Error('Expected OpenUI component renderer to be available.');
  }

  return renderer as (args: { props: Record<string, unknown> }) => ReactNode;
}

function findElementWithHandler(
  node: ReactNode,
  handlerName: 'onBlur' | 'onChange',
): ReactElement<Record<typeof handlerName, (event?: unknown) => void>> {
  if (!isValidElement(node)) {
    throw new Error(`Could not find ${handlerName} handler.`);
  }

  if (typeof (node.props as Record<string, unknown>)[handlerName] === 'function') {
    return node as ReactElement<Record<typeof handlerName, (event?: unknown) => void>>;
  }

  const children = (node.props as { children?: ReactNode }).children;

  if (!Array.isArray(children)) {
    if (children) {
      return findElementWithHandler(children, handlerName);
    }

    throw new Error(`Could not find ${handlerName} handler.`);
  }

  for (const child of children) {
    if (!isValidElement(child)) {
      continue;
    }

    try {
      return findElementWithHandler(child, handlerName);
    } catch {
      // Keep scanning sibling elements.
    }
  }

  throw new Error(`Could not find ${handlerName} handler.`);
}

async function renderTextField(componentName: 'InputComponent' | 'TextAreaComponent') {
  const renderer =
    componentName === 'InputComponent'
      ? getComponentRenderer((await import('@pages/Chat/builder/openui/library/components/Input')).InputComponent)
      : getComponentRenderer((await import('@pages/Chat/builder/openui/library/components/TextArea')).TextAreaComponent);

  return renderer({
    props: {
      appearance: undefined,
      helper: null,
      label: 'Field',
      name: 'field',
      placeholder: '',
      type: 'text',
      validation: [{ type: 'required' }],
      value: '',
    },
  });
}

describe('OpenUI text field interactions', () => {
  it.each(['InputComponent', 'TextAreaComponent'] as const)(
    'updates %s values without marking the field touched while typing',
    async (componentName) => {
      textFieldHarness.onBlur.mockClear();
      textFieldHarness.setValue.mockClear();

      const rendered = await renderTextField(componentName);
      const input = findElementWithHandler(rendered, 'onChange');

      input.props.onChange({
        target: {
          value: 'typed value',
        },
      });

      expect(textFieldHarness.setValue).toHaveBeenCalledWith('typed value');
      expect(textFieldHarness.onBlur).not.toHaveBeenCalled();

      const blurTarget = findElementWithHandler(rendered, 'onBlur');
      blurTarget.props.onBlur();

      expect(textFieldHarness.onBlur).toHaveBeenCalledTimes(1);
    },
  );
});
