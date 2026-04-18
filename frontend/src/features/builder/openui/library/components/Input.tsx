import { defineComponent, reactive, useIsStreaming, useStateField, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { Input as InputUI } from '@components/ui/input';
import { z } from 'zod';
import { nullableTextSchema } from './shared';

type InputRendererProps = ComponentRenderProps<{
  label: string;
  name: string;
  placeholder?: string | null;
  value: StateField<string | undefined>;
}>;

function OpenUiInputRenderer({ props }: InputRendererProps) {
  const isStreaming = useIsStreaming();
  const field = useStateField(props.name, props.value);
  const autoComplete = props.name === 'name' ? 'name' : props.name === 'email' ? 'email' : undefined;

  return (
    <label className="flex flex-col gap-2">
      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-slate-600">{props.label}</span>
      <InputUI
        autoComplete={autoComplete}
        disabled={isStreaming}
        name={props.name}
        placeholder={props.placeholder ?? undefined}
        value={field.value ?? ''}
        onChange={(event) => field.setValue(event.target.value)}
      />
    </label>
  );
}

export const InputComponent = defineComponent({
  name: 'Input',
  description: 'Single-line text input. Bind the value to a $variable for two-way state.',
  props: z.object({
    name: z.string().describe('Stable field name used for persistence and bindings.'),
    label: z.string().describe('Visible label for the field.'),
    value: reactive(z.string().optional().describe('Current value, often bound to a $variable.')),
    placeholder: nullableTextSchema.describe('Placeholder text shown when empty.'),
  }),
  component: OpenUiInputRenderer,
});
