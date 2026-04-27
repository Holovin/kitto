import { defineComponent, useIsStreaming, useStateField, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { Checkbox as CheckboxUI } from '@components/ui/checkbox';
import { cn } from '@helpers/utils';
import { z } from 'zod';
import { actionModeReactive } from '../promptSignatures';
import {
  appearanceSchema,
  getAppearanceStyle,
  nullableTextSchema,
  useKittoAppearanceScope,
  validationRulesSchema,
  type ValidationRuleConfig,
} from './shared';
import { useActionModeControl } from './useActionModeControl';
import { useFormFieldValidation } from './useFormFieldValidation';

type CheckboxRendererProps = ComponentRenderProps<{
  action?: unknown;
  appearance?: { contrastColor?: string; mainColor?: string };
  checked?: StateField<boolean | undefined> | boolean;
  helper?: string | null;
  label: string;
  name: string;
  validation?: ValidationRuleConfig[];
}>;

function OpenUiCheckboxRenderer({ props }: CheckboxRendererProps) {
  const isStreaming = useIsStreaming();
  const field = useStateField(props.name, props.checked);
  const { isActionMode, isPending, runAction } = useActionModeControl({
    action: props.action,
    name: props.name || 'checkbox',
    queue: 'checkbox',
  });
  const hasLabel = props.label.trim().length > 0;
  const validationTarget = { componentType: 'Checkbox' as const };
  const checkedValue = isActionMode ? Boolean(props.checked) : Boolean(field.value);
  const { ariaProps, hasVisibleError, helperText, onBlur } = useFormFieldValidation({
    helper: props.helper,
    name: props.name,
    skip: isActionMode,
    target: validationTarget,
    validation: props.validation,
    value: checkedValue,
  });
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
      {...ariaProps}
      checked={checkedValue}
      className={cn(hasVisibleError && 'border-rose-400 focus-visible:border-rose-500')}
      disabled={isActionMode ? isStreaming || isPending : isStreaming}
      id={props.name}
      name={props.name}
      style={checkboxStyle}
      onBlur={isActionMode ? undefined : onBlur}
      onCheckedChange={
        isActionMode
          ? (checked: boolean | 'indeterminate') => {
              runAction(Boolean(checked)).catch(() => undefined);
            }
          : (checked: boolean | 'indeterminate') => {
              onBlur();
              field.setValue(Boolean(checked));
            }
      }
    />
  );

  if (!hasLabel) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex h-5 items-center">{checkboxControl}</div>
        {helperText ? (
          <p className="text-sm leading-6 text-slate-500" id={ariaProps['aria-describedby']}>
            {helperText}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        className={cn(
          'flex items-start gap-3 rounded-[1.25rem] border bg-white px-4 py-3',
          hasVisibleError ? 'border-rose-400' : 'border-slate-200',
        )}
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
        <p className="text-sm leading-6 text-slate-500" id={ariaProps['aria-describedby']}>
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

export const CheckboxComponent = defineComponent({
  name: 'Checkbox',
  description:
    'Boolean toggle for either local form state or explicit action flows. Use a $binding<boolean> for form state, or a display-only boolean plus action for persisted row toggles. Required validation means the checkbox must be checked.',
  props: z.object({
    name: z.string().describe('Stable field name used for persistence and bindings.'),
    label: z.string().describe('Visible label shown next to the checkbox.'),
    checked: actionModeReactive(
      z
        .boolean()
        .optional()
        .describe('Writable $binding<boolean> for form state, or a display-only boolean when action mode runs an explicit Action([...]).'),
    ),
    helper: nullableTextSchema.describe('Optional helper text shown below the control when there is no validation error.'),
    validation: validationRulesSchema,
    action: z.unknown().optional().describe('Optional Action([...]) for persisted row toggles or other explicit checkbox-triggered flows.'),
    appearance: appearanceSchema,
  }),
  component: OpenUiCheckboxRenderer,
});
