import {
  defineComponent,
  reactive,
  useIsStreaming,
  useSetFieldValue,
  useStateField,
  type ComponentRenderProps,
  type StateField,
} from '@openuidev/react-lang';
import { Select as SelectUI, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select';
import { z } from 'zod';
import {
  ACTION_MODE_LAST_CHOICE_STATE,
  appearanceSchema,
  choiceOptionSchema,
  getAppearanceStyle,
  nullableTextSchema,
  useKittoAppearanceScope,
  validationRulesSchema,
  type ValidationRuleConfig,
} from './shared';
import { useActionModeControl } from './useActionModeControl';
import { useFormFieldValidation } from './useFormFieldValidation';

type SelectRendererProps = ComponentRenderProps<{
  action?: unknown;
  appearance?: { contrastColor?: string; mainColor?: string };
  helper?: string | null;
  label: string;
  name: string;
  options: Array<{ label: string; value: string }>;
  validation?: ValidationRuleConfig[];
  value: StateField<string | undefined> | string | undefined;
}>;

function OpenUiSelectRenderer({ props }: SelectRendererProps) {
  const isStreaming = useIsStreaming();
  const setFieldValue = useSetFieldValue();
  const field = useStateField(props.name, props.value);
  const { isActionMode, isPending, runAction } = useActionModeControl({
    action: props.action,
    beforeRun: (nextValue: string) => {
      setFieldValue(undefined, undefined, ACTION_MODE_LAST_CHOICE_STATE, nextValue, false);
    },
    name: props.name || 'select',
    queue: 'choice',
  });
  const validationTarget = { componentType: 'Select' as const };
  const selectedValue = isActionMode ? (typeof props.value === 'string' ? props.value : '') : (field.value ?? '');
  const { ariaProps, hasVisibleError, helperText, onBlur } = useFormFieldValidation({
    helper: props.helper,
    name: props.name,
    skip: isActionMode,
    target: validationTarget,
    validation: props.validation,
    value: selectedValue,
  });
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
      <SelectUI
        autoComplete="off"
        disabled={isActionMode ? isStreaming || isPending : isStreaming}
        name={props.name}
        value={selectedValue}
        onValueChange={(nextValue: string) => {
          if (isActionMode) {
            void runAction(nextValue);
            return;
          }

          onBlur();
          field.setValue(nextValue);
        }}
      >
        <SelectTrigger
          {...ariaProps}
          aria-label={props.label}
          className={hasVisibleError ? 'border-rose-400 focus-visible:border-rose-500' : undefined}
          style={selectStyle}
          onBlur={isActionMode ? undefined : onBlur}
        >
          <SelectValue placeholder="Select an option" />
        </SelectTrigger>
        <SelectContent portalled={false} style={selectStyle}>
          {props.options.map((option) => (
            <SelectItem key={option.value} style={itemStyle} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </SelectUI>
      {helperText ? (
        <p className="text-sm leading-6 text-slate-500" id={ariaProps['aria-describedby']}>
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

export const SelectComponent = defineComponent({
  name: 'Select',
  description:
    'Dropdown selector with optional helper text and declarative validation for choosing one item from a short list of label/value pairs. Use a $binding<string> for form state, or a display-only string plus action for persisted updates. In action mode, the runtime writes the new option to `$lastChoice` before Action([...]) runs.',
  props: z.object({
    name: z.string().describe('Stable field name used for persistence and bindings.'),
    label: z.string().describe('Visible label for the select field.'),
    value: reactive(
      z
        .string()
        .optional()
        .describe('Writable $binding<string> for form state, or a display-only string when action mode runs an explicit Action([...]).'),
    ),
    options: z.array(choiceOptionSchema).default([]).describe('Option list with label/value pairs.'),
    helper: nullableTextSchema.describe('Optional helper text shown below the control when there is no validation error.'),
    validation: validationRulesSchema,
    action: z
      .unknown()
      .optional()
      .describe('Optional Action([...]) for persisted choice updates. Action mode writes the selected option to `$lastChoice` before the action runs.'),
    appearance: appearanceSchema,
  }),
  component: OpenUiSelectRenderer,
});
