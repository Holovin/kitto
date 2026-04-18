import { defineComponent, reactive, useIsStreaming, useStateField, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { Select as SelectUI, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select';
import { z } from 'zod';
import { choiceOptionSchema } from './shared';

type SelectRendererProps = ComponentRenderProps<{
  label: string;
  name: string;
  options: Array<{ label: string; value: string }>;
  value: StateField<string | undefined>;
}>;

function OpenUiSelectRenderer({ props }: SelectRendererProps) {
  const isStreaming = useIsStreaming();
  const field = useStateField(props.name, props.value);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-slate-600">{props.label}</span>
      <SelectUI disabled={isStreaming} name={props.name} value={field.value ?? ''} onValueChange={field.setValue}>
        <SelectTrigger aria-label={props.label}>
          <SelectValue placeholder="Select an option" />
        </SelectTrigger>
        <SelectContent>
          {props.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </SelectUI>
    </div>
  );
}

export const SelectComponent = defineComponent({
  name: 'Select',
  description: 'Dropdown selector for choosing one item from a short list of label/value pairs.',
  props: z.object({
    name: z.string().describe('Stable field name used for persistence and bindings.'),
    label: z.string().describe('Visible label for the select field.'),
    value: reactive(z.string().optional().describe('Currently selected value, often bound to a $variable.')),
    options: z.array(choiceOptionSchema).default([]).describe('Option list with label/value pairs.'),
  }),
  component: OpenUiSelectRenderer,
});
