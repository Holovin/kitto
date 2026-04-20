import { defineComponent, reactive, useIsStreaming, useStateField, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { Textarea as TextareaUI } from '@components/ui/textarea';
import { z } from 'zod';
import { appearanceSchema, getAppearanceStyle, nullableTextSchema, useKittoAppearanceScope } from './shared';

type TextAreaRendererProps = ComponentRenderProps<{
  appearance?: { bgColor?: string; textColor?: string };
  label: string;
  name: string;
  placeholder?: string | null;
  value: StateField<string | undefined>;
}>;

function OpenUiTextAreaRenderer({ props }: TextAreaRendererProps) {
  const isStreaming = useIsStreaming();
  const field = useStateField(props.name, props.value);
  const appearanceScope = useKittoAppearanceScope();
  const labelStyle = getAppearanceStyle({
    appearance: props.appearance,
    applyTextColor: true,
    hasInheritedTextColor: appearanceScope.hasTextColor,
  });
  const textAreaStyle = getAppearanceStyle({
    appearance: props.appearance,
    applyTextColor: true,
    applyBackgroundColor: true,
    hasInheritedTextColor: appearanceScope.hasTextColor,
    hasInheritedBgColor: appearanceScope.hasBgColor,
  });

  return (
    <label className="flex flex-col gap-2">
      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-slate-600" style={labelStyle}>
        {props.label}
      </span>
      <TextareaUI
        disabled={isStreaming}
        name={props.name}
        placeholder={props.placeholder ?? undefined}
        style={textAreaStyle}
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
    appearance: appearanceSchema,
  }),
  component: OpenUiTextAreaRenderer,
});
