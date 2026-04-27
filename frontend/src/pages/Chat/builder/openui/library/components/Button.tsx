import { defineComponent, reactive, useIsStreaming, useStateField, useTriggerAction, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { Button as ButtonUI } from '@components/ui/button';
import { z } from 'zod';
import { appearanceSchema, getAppearanceStyle, resolveOpenUiAction, useKittoAppearanceScope, useKittoValidationInteraction } from './shared';

const variantSchema = z.enum(['default', 'secondary', 'destructive']).default('default');

type ButtonRendererProps = ComponentRenderProps<{
  action?: unknown;
  appearance?: { contrastColor?: string; mainColor?: string };
  disabled?: StateField<boolean>;
  id: string;
  label: string;
  variant: 'default' | 'secondary' | 'destructive';
}>;

function OpenUiButtonRenderer({ props }: ButtonRendererProps) {
  const triggerAction = useTriggerAction();
  const isStreaming = useIsStreaming();
  const disabledField = useStateField(`__button_disabled__:${props.id}`, props.disabled);
  const { getRegisteredFieldNames, markSubmitLikeInteraction } = useKittoValidationInteraction();
  const appearanceScope = useKittoAppearanceScope();
  const shouldApplyButtonAppearance = Boolean(props.appearance) || appearanceScope.hasMainColor || appearanceScope.hasContrastColor;
  const openUiButtonClassName =
    props.variant === 'secondary'
      ? 'border border-slate-200 !ring-0 !shadow-none hover:!shadow-none'
      : 'border border-slate-200 !shadow-none hover:!shadow-none';
  const buttonStyle = getAppearanceStyle({
    appearance: props.appearance,
    backgroundRole: shouldApplyButtonAppearance ? 'main' : undefined,
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
    hasInheritedMainColor: appearanceScope.hasMainColor,
    textRole: shouldApplyButtonAppearance ? 'contrast' : undefined,
  });

  return (
    <ButtonUI
      className={openUiButtonClassName}
      disabled={isStreaming || Boolean(disabledField.value)}
      style={buttonStyle}
      variant={props.variant}
      onClick={() => {
        if (props.variant === 'default') {
          markSubmitLikeInteraction(getRegisteredFieldNames());
        }
        Promise.resolve(triggerAction(props.label, undefined, resolveOpenUiAction(props.action))).catch(() => undefined);
      }}
    >
      <span>{props.label}</span>
    </ButtonUI>
  );
}

export const ButtonComponent = defineComponent({
  name: 'Button',
  description:
    'Clickable action trigger. The first argument must be a stable id string, followed by the visible label. Action([...]) runs steps in order, so one button can combine multiple @Run, @Set, @Reset, or @ToAssistant steps. When appearance is present, mainColor sets the button fill and contrastColor sets the button text.',
  props: z.object({
    id: z.string().describe('Stable action and state key. Required first argument.'),
    label: z.string().describe('Visible button label.'),
    variant: variantSchema.describe('Fallback visual style when no appearance override is present: default, secondary, or destructive.'),
    action: z.unknown().optional().describe('Usually Action([...]) with one or more @Run, @Set, @Reset, or @ToAssistant steps executed in order.'),
    disabled: reactive(z.boolean().optional().default(false).describe('Whether the button is disabled.')),
    appearance: appearanceSchema,
  }),
  component: OpenUiButtonRenderer,
});
