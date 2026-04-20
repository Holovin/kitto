import { useId, useState } from 'react';
import { defineComponent, reactive, useIsStreaming, useStateField, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { Checkbox as CheckboxUI } from '@components/ui/checkbox';
import { z } from 'zod';
import {
  appearanceSchema,
  evaluateValidationRules,
  getAppearanceStyle,
  nullableTextSchema,
  sanitizeValidationRules,
  useKittoAppearanceScope,
  validationRulesSchema,
  type ValidationRuleConfig,
} from './shared';

type CheckboxRendererProps = ComponentRenderProps<{
  appearance?: { contrastColor?: string; mainColor?: string };
  checked: StateField<boolean | undefined>;
  helper?: string | null;
  label: string;
  name: string;
  validation?: ValidationRuleConfig[];
}>;

function OpenUiCheckboxRenderer({ props }: CheckboxRendererProps) {
  const feedbackId = useId();
  const [touched, setTouched] = useState(false);
  const isStreaming = useIsStreaming();
  const field = useStateField(props.name, props.checked);
  const hasLabel = props.label.trim().length > 0;
  const validationTarget = { componentType: 'Checkbox' as const };
  const validationRules = sanitizeValidationRules(validationTarget, props.validation);
  const validationError = touched
    ? evaluateValidationRules({
        rules: validationRules,
        target: validationTarget,
        value: Boolean(field.value),
      })
    : undefined;
  const hasVisibleError = validationError !== undefined;
  const helperText =
    validationError ?? (typeof props.helper === 'string' && props.helper.trim().length > 0 ? props.helper : undefined);
  const appearanceScope = useKittoAppearanceScope();
  const checkboxStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    backgroundRole: 'main',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
    hasInheritedMainColor: appearanceScope.hasMainColor,
  });
  const labelStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
  });
  const checkboxControl = (
    <CheckboxUI
      aria-describedby={helperText ? feedbackId : undefined}
      aria-invalid={hasVisibleError}
      checked={Boolean(field.value)}
      className={hasVisibleError ? 'border-rose-400 focus-visible:border-rose-500' : undefined}
      disabled={isStreaming}
      style={checkboxStyle}
      onBlur={() => setTouched(true)}
      onCheckedChange={(checked: boolean | 'indeterminate') => {
        setTouched(true);
        field.setValue(Boolean(checked));
      }}
    />
  );

  if (!hasLabel) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex h-5 items-center">{checkboxControl}</div>
        {helperText ? (
          <p
            className={hasVisibleError ? 'text-sm leading-6 text-rose-600' : 'text-sm leading-6 text-slate-500'}
            id={feedbackId}
          >
            {helperText}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        className={`flex items-start gap-3 rounded-[1.25rem] border bg-white px-4 py-3 ${
          hasVisibleError ? 'border-rose-300' : 'border-slate-200'
        }`}
        style={checkboxStyle}
      >
        {checkboxControl}
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium text-slate-900" style={labelStyle}>
            {props.label}
          </span>
        </span>
      </label>
      {helperText ? (
        <p
          className={hasVisibleError ? 'text-sm leading-6 text-rose-600' : 'text-sm leading-6 text-slate-500'}
          id={feedbackId}
        >
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

export const CheckboxComponent = defineComponent({
  name: 'Checkbox',
  description:
    'Boolean toggle with optional helper text and declarative validation. Required validation means the checkbox must be checked.',
  props: z.object({
    name: z.string().describe('Stable field name used for persistence and bindings.'),
    label: z.string().describe('Visible label shown next to the checkbox.'),
    checked: reactive(z.boolean().optional().describe('Current checked state, often bound to a $variable.')),
    helper: nullableTextSchema.describe('Optional helper text shown below the control when there is no validation error.'),
    validation: validationRulesSchema,
    appearance: appearanceSchema,
  }),
  component: OpenUiCheckboxRenderer,
});
