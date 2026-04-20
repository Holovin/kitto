import { defineComponent, reactive, useIsStreaming, useStateField, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { RadioGroup as RadioGroupUI, RadioGroupItem } from '@components/ui/radio-group';
import { z } from 'zod';
import { choiceOptionSchema, getHexColorStyle, hexColorOverrideProps } from './shared';

type RadioGroupRendererProps = ComponentRenderProps<{
  background?: string;
  color?: string;
  label: string;
  name: string;
  options: Array<{ label: string; value: string }>;
  value: StateField<string | undefined>;
}>;

function OpenUiRadioGroupRenderer({ props }: RadioGroupRendererProps) {
  const isStreaming = useIsStreaming();
  const field = useStateField(props.name, props.value);

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-slate-600" style={getHexColorStyle({ color: props.color })}>
        {props.label}
      </span>
      <RadioGroupUI disabled={isStreaming} value={field.value ?? ''} onValueChange={field.setValue}>
        {props.options.map((option) => (
          <label
            key={option.value}
            className="flex items-center gap-3 rounded-[1.25rem] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800"
            style={getHexColorStyle(props)}
          >
            <RadioGroupItem style={getHexColorStyle(props)} value={option.value} />
            <span>{option.label}</span>
          </label>
        ))}
      </RadioGroupUI>
    </div>
  );
}

export const RadioGroupComponent = defineComponent({
  name: 'RadioGroup',
  description: 'Single-choice list of options. Good for quizzes, steps, and mode switches.',
  props: z.object({
    name: z.string().describe('Stable field name used for persistence and bindings.'),
    label: z.string().describe('Visible label for the option set.'),
    value: reactive(z.string().optional().describe('Currently selected option value, often bound to a $variable.')),
    options: z.array(choiceOptionSchema).default([]).describe('Option list with label/value pairs.'),
    ...hexColorOverrideProps,
  }),
  component: OpenUiRadioGroupRenderer,
});
