import { createLibrary } from '@openuidev/react-lang';
import { AppShellComponent } from './components/AppShell';
import { ButtonComponent } from './components/Button';
import { CheckboxComponent } from './components/Checkbox';
import { GroupComponent } from './components/Group';
import { InputComponent } from './components/Input';
import { LinkComponent } from './components/Link';
import { RadioGroupComponent } from './components/RadioGroup';
import { RepeaterComponent } from './components/Repeater';
import { ScreenComponent } from './components/Screen';
import { SelectComponent } from './components/Select';
import { TextComponent } from './components/Text';
import { TextAreaComponent } from './components/TextArea';

export const builderOpenUiLibrary = createLibrary({
  root: 'AppShell',
  componentGroups: [
    {
      name: 'Containers',
      components: ['AppShell', 'Screen', 'Group', 'Repeater', 'Text'],
      notes: [
        'Use Screen for major steps and Group for local layout.',
        'Use Group variant "block" for standalone visual sections and variant "inline" for nested groups, inline controls, and repeated rows.',
        'Use AppShell.appearance for one shared theme pair, with mainColor as the main surface and contrastColor as the contrasting text/action color.',
        'Use Screen/Group/Repeater appearance only when a subtree needs a local theme override.',
        'Use Repeater with rows built by @Each(collection, "item", ...). Read persisted collections with Query("read_state", ...) before repeating them.',
      ],
    },
    {
      name: 'Inputs',
      components: ['Input', 'TextArea', 'Checkbox', 'RadioGroup', 'Select'],
      notes: [
        'Bind interactive values to $variables when the user should control them.',
        'Checkbox, RadioGroup, and Select can also run in action mode with display-only values plus Action([...]).',
        'Never combine action with a writable $binding on Checkbox, RadioGroup, or Select. Action mode uses display values; binding mode uses only $variables.',
        'RadioGroup and Select action mode write the newly chosen option to $lastChoice before the action runs.',
      ],
    },
    {
      name: 'Actions',
      components: ['Button', 'Link'],
      notes: ['Use Button with Action([...]) for Query and Mutation flows. When appearance is present, all button variants use mainColor for background and contrastColor for text.'],
    },
  ],
  components: [
    AppShellComponent,
    ScreenComponent,
    GroupComponent,
    RepeaterComponent,
    TextComponent,
    InputComponent,
    TextAreaComponent,
    CheckboxComponent,
    RadioGroupComponent,
    SelectComponent,
    ButtonComponent,
    LinkComponent,
  ],
});

const actionModePromptSignatureOverrides = {
  Checkbox:
    'Checkbox(name: string, label: string, checked?: $binding<boolean> | boolean, helper?: string | any, validation?: {type: "required" | "minLength" | "maxLength" | "minNumber" | "maxNumber" | "dateOnOrAfter" | "dateOnOrBefore" | "email", value?: number | string, message?: string}[], action?: any, appearance?: {mainColor?: string, contrastColor?: string})',
  RadioGroup:
    'RadioGroup(name: string, label: string, value?: $binding<string> | string, options?: {label: string, value: string}[], helper?: string | any, validation?: {type: "required" | "minLength" | "maxLength" | "minNumber" | "maxNumber" | "dateOnOrAfter" | "dateOnOrBefore" | "email", value?: number | string, message?: string}[], action?: any, appearance?: {mainColor?: string, contrastColor?: string})',
  Select:
    'Select(name: string, label: string, value?: $binding<string> | string, options?: {label: string, value: string}[], helper?: string | any, validation?: {type: "required" | "minLength" | "maxLength" | "minNumber" | "maxNumber" | "dateOnOrAfter" | "dateOnOrBefore" | "email", value?: number | string, message?: string}[], action?: any, appearance?: {mainColor?: string, contrastColor?: string})',
} as const;

export function getBuilderOpenUiSpec() {
  const spec = builderOpenUiLibrary.toSpec();

  return {
    ...spec,
    components: {
      ...spec.components,
      ...Object.fromEntries(
        Object.entries(actionModePromptSignatureOverrides).flatMap(([componentName, signature]) => {
          const componentSpec = spec.components[componentName];

          return componentSpec ? [[componentName, { ...componentSpec, signature }]] : [];
        }),
      ),
    },
  };
}
