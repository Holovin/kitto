import { defineComponent, reactive, useIsStreaming, useStateField, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { Input as InputUI } from '@components/ui/input';
import { cn } from '@helpers/utils';
import { z } from 'zod';
import {
  appearanceSchema,
  getAppearanceStyle,
  getInputAutoComplete,
  inputTypeSchema,
  nullableTextSchema,
  useKittoAppearanceScope,
  validationRulesSchema,
  type InputType,
  type ValidationRuleConfig,
} from './shared';
import { useFormFieldValidation } from './useFormFieldValidation';

type InputRendererProps = ComponentRenderProps<{
  appearance?: { contrastColor?: string; mainColor?: string };
  helper?: string | null;
  label: string;
  name: string;
  placeholder?: string | null;
  type: InputType;
  validation?: ValidationRuleConfig[];
  value: StateField<string | undefined>;
}>;

function OpenUiInputRenderer({ props }: InputRendererProps) {
  const isStreaming = useIsStreaming();
  const field = useStateField(props.name, props.value);
  const validationTarget = {
    componentType: 'Input' as const,
    inputType: props.type,
  };
  const { ariaProps, hasVisibleError, helperText, onBlur } = useFormFieldValidation({
    helper: props.helper,
    name: props.name,
    target: validationTarget,
    validation: props.validation,
    value: field.value ?? '',
  });
  const autoComplete = getInputAutoComplete(props.name, props.type);
  const appearanceScope = useKittoAppearanceScope();
  const labelStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
  });
  const inputStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    backgroundRole: 'main',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
    hasInheritedMainColor: appearanceScope.hasMainColor,
  });

  return (
    <label className="flex flex-col gap-2">
      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-slate-600" style={labelStyle}>
        {props.label}
      </span>
      <InputUI
        {...ariaProps}
        autoComplete={autoComplete}
        className={cn(hasVisibleError && 'border-rose-400 focus-visible:border-rose-500')}
        disabled={isStreaming}
        id={props.name}
        name={props.name}
        placeholder={props.placeholder ?? undefined}
        style={inputStyle}
        type={props.type}
        value={field.value ?? ''}
        onBlur={onBlur}
        onChange={(event) => {
          onBlur();
          field.setValue(event.target.value);
        }}
      />
      {helperText ? (
        <p className="text-sm leading-6 text-slate-500" id={ariaProps['aria-describedby']}>
          {helperText}
        </p>
      ) : null}
    </label>
  );
}

export const InputComponent = defineComponent({
  name: 'Input',
  description:
    'Single-line input with HTML type support, optional helper text, and declarative validation. Values always stay strings, including number, date, and time inputs.',
  props: z.object({
    name: z.string().describe('Stable field name used for persistence and bindings.'),
    label: z.string().describe('Visible label for the field.'),
    value: reactive(z.string().optional().describe('Current value, often bound to a $variable. Input values always stay strings.')),
    placeholder: nullableTextSchema.describe('Placeholder text shown when empty.'),
    helper: nullableTextSchema.describe('Optional helper text shown below the control when there is no validation error.'),
    type: inputTypeSchema,
    validation: validationRulesSchema,
    appearance: appearanceSchema,
  }),
  component: OpenUiInputRenderer,
});
