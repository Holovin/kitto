import {
  defineComponent,
  reactive,
  useIsStreaming,
  useSetFieldValue,
  useStateField,
  type ComponentRenderProps,
  type StateField,
} from '@openuidev/react-lang';
import { RadioGroup as RadioGroupUI, RadioGroupItem } from '@components/ui/radio-group';
import { cn } from '@lib/utils';
import { z } from 'zod';
import {
  ACTION_MODE_LAST_CHOICE_STATE,
  appearanceSchema,
  choiceOptionSchema,
  getAppearanceStyle,
  nullableTextSchema,
  normalizeChoiceOptions,
  useKittoAppearanceScope,
  validationRulesSchema,
  type ValidationRuleConfig,
} from './shared';
import { useActionModeControl } from './useActionModeControl';
import { useFormFieldValidation } from './useFormFieldValidation';

type RadioGroupRendererProps = ComponentRenderProps<{
  action?: unknown;
  appearance?: { contrastColor?: string; mainColor?: string };
  helper?: string | null;
  label: string;
  name: string;
  options: Array<{ label: string; value: string }>;
  validation?: ValidationRuleConfig[];
  value: StateField<string | undefined> | string | undefined;
}>;

function OpenUiRadioGroupRenderer({ props }: RadioGroupRendererProps) {
  const isStreaming = useIsStreaming();
  const setFieldValue = useSetFieldValue();
  const field = useStateField(props.name, props.value);
  const { isActionMode, isPending, runAction } = useActionModeControl({
    action: props.action,
    beforeRun: (nextValue: string) => {
      setFieldValue(undefined, undefined, ACTION_MODE_LAST_CHOICE_STATE, nextValue, false);
    },
    name: props.name || 'radio-group',
    queue: 'choice',
  });
  const validationTarget = { componentType: 'RadioGroup' as const };
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
  const optionStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    backgroundRole: 'main',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
    hasInheritedMainColor: appearanceScope.hasMainColor,
  });
  const options = normalizeChoiceOptions(props.options);

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-slate-600" style={labelStyle}>
        {props.label}
      </span>
      <RadioGroupUI
        {...ariaProps}
        disabled={isActionMode ? isStreaming || isPending : isStreaming}
        name={props.name}
        value={selectedValue}
        onBlur={isActionMode ? undefined : onBlur}
        onValueChange={(nextValue: string) => {
          if (isActionMode) {
            runAction(nextValue).catch(() => undefined);
            return;
          }

          onBlur();
          field.setValue(nextValue);
        }}
      >
        {options.map((option, index) => (
          <label
            key={`${option.value}:${index}`}
            className={cn(
              'flex items-center gap-3 rounded-[1.25rem] border bg-white px-4 py-3 text-sm text-slate-800',
              hasVisibleError ? 'border-rose-300' : 'border-slate-200',
            )}
            style={optionStyle}
          >
            <RadioGroupItem
              className={cn(hasVisibleError && 'border-rose-400 focus-visible:border-rose-500')}
              style={optionStyle}
              value={option.value}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </RadioGroupUI>
      {helperText ? (
        <p className="text-sm leading-6 text-slate-500" id={ariaProps['aria-describedby']}>
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

export const RadioGroupComponent = defineComponent({
  name: 'RadioGroup',
  description:
    'Single-choice list of options with optional helper text and declarative validation. Use a $binding<string> for form state, or a display-only string plus action for persisted choice updates. In action mode, the runtime writes the new option to `$lastChoice` before Action([...]) runs.',
  props: z.object({
    name: z.string().describe('Stable field name used for persistence and bindings.'),
    label: z.string().describe('Visible label for the option set.'),
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
  component: OpenUiRadioGroupRenderer,
});
