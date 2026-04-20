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
        'Use AppShell.appearance for one shared theme, and use Screen/Group/Repeater appearance only when a subtree needs a local override.',
        'Use Repeater with rows built by @Each(collection, "item", ...). Read persisted collections with Query("read_state", ...) before repeating them.',
      ],
    },
    {
      name: 'Inputs',
      components: ['Input', 'TextArea', 'Checkbox', 'RadioGroup', 'Select'],
      notes: ['Bind interactive values to $variables when the user should control them.'],
    },
    {
      name: 'Actions',
      components: ['Button', 'Link'],
      notes: ['Use Button with Action([...]) for Query and Mutation flows.'],
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
