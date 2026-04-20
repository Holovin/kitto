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
        'RadioGroup and Select action mode write the newly chosen option to $lastChoice before the action runs.',
      ],
    },
    {
      name: 'Actions',
      components: ['Button', 'Link'],
      notes: ['Use Button with Action([...]) for Query and Mutation flows. Default buttons invert the inherited theme pair automatically.'],
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

export function getBuilderOpenUiSpec() {
  const spec = builderOpenUiLibrary.toSpec();
  const checkboxSpec = spec.components.Checkbox;
  const radioGroupSpec = spec.components.RadioGroup;
  const selectSpec = spec.components.Select;

  return {
    ...spec,
    components: {
      ...spec.components,
      ...(checkboxSpec
        ? {
            Checkbox: {
              ...checkboxSpec,
              signature: checkboxSpec.signature.replace('checked?: $binding<boolean>', 'checked?: $binding<boolean> | boolean'),
            },
          }
        : {}),
      ...(radioGroupSpec
        ? {
            RadioGroup: {
              ...radioGroupSpec,
              signature: radioGroupSpec.signature.replace('value?: $binding<string>', 'value?: $binding<string> | string'),
            },
          }
        : {}),
      ...(selectSpec
        ? {
            Select: {
              ...selectSpec,
              signature: selectSpec.signature.replace('value?: $binding<string>', 'value?: $binding<string> | string'),
            },
          }
        : {}),
    },
  };
}
