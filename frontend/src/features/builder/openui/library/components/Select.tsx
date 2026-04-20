import { defineComponent, reactive, useIsStreaming, useStateField, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { Select as SelectUI, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select';
import { z } from 'zod';
import { appearanceSchema, choiceOptionSchema, getAppearanceStyle, useKittoAppearanceScope } from './shared';

type SelectRendererProps = ComponentRenderProps<{
  appearance?: { contrastColor?: string; mainColor?: string };
  label: string;
  name: string;
  options: Array<{ label: string; value: string }>;
  value: StateField<string | undefined>;
}>;

function OpenUiSelectRenderer({ props }: SelectRendererProps) {
  const isStreaming = useIsStreaming();
  const field = useStateField(props.name, props.value);
  const appearanceScope = useKittoAppearanceScope();
  const labelStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
  });
  const selectStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    backgroundRole: 'main',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
    hasInheritedMainColor: appearanceScope.hasMainColor,
  });
  const itemStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
  });

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-slate-600" style={labelStyle}>
        {props.label}
      </span>
      <SelectUI disabled={isStreaming} name={props.name} value={field.value ?? ''} onValueChange={field.setValue}>
        <SelectTrigger aria-label={props.label} style={selectStyle}>
          <SelectValue placeholder="Select an option" />
        </SelectTrigger>
        <SelectContent style={selectStyle}>
          {props.options.map((option) => (
            <SelectItem key={option.value} style={itemStyle} value={option.value}>
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
    appearance: appearanceSchema,
  }),
  component: OpenUiSelectRenderer,
});
