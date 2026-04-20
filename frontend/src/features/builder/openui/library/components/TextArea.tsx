import { defineComponent, reactive, useIsStreaming, useStateField, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { Textarea as TextareaUI } from '@components/ui/textarea';
import { z } from 'zod';
import { getHexColorStyle, hexColorOverrideProps, nullableTextSchema } from './shared';

type TextAreaRendererProps = ComponentRenderProps<{
  background?: string;
  color?: string;
  label: string;
  name: string;
  placeholder?: string | null;
  value: StateField<string | undefined>;
}>;

function OpenUiTextAreaRenderer({ props }: TextAreaRendererProps) {
  const isStreaming = useIsStreaming();
  const field = useStateField(props.name, props.value);

  return (
    <label className="flex flex-col gap-2">
      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-slate-600" style={getHexColorStyle({ color: props.color })}>
        {props.label}
      </span>
      <TextareaUI
        disabled={isStreaming}
        name={props.name}
        placeholder={props.placeholder ?? undefined}
        style={getHexColorStyle(props)}
        value={field.value ?? ''}
        onChange={(event) => field.setValue(event.target.value)}
      />
    </label>
  );
}

export const TextAreaComponent = defineComponent({
  name: 'TextArea',
  description: 'Multi-line text input for longer descriptions, prompts, or notes.',
  props: z.object({
    name: z.string().describe('Stable field name used for persistence and bindings.'),
    label: z.string().describe('Visible label for the field.'),
    value: reactive(z.string().optional().describe('Current value, often bound to a $variable.')),
    placeholder: nullableTextSchema.describe('Placeholder text shown when empty.'),
    ...hexColorOverrideProps,
  }),
  component: OpenUiTextAreaRenderer,
});
