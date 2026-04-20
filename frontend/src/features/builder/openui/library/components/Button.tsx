import { defineComponent, reactive, useIsStreaming, useStateField, useTriggerAction, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { Button as ButtonUI } from '@components/ui/button';
import { z } from 'zod';
import { getHexColorStyle, hexColorOverrideProps } from './shared';

const variantSchema = z.enum(['default', 'secondary', 'destructive']).default('default');

type ButtonRendererProps = ComponentRenderProps<{
  action?: unknown;
  background?: string;
  color?: string;
  disabled?: StateField<boolean>;
  id: string;
  label: string;
  variant: 'default' | 'secondary' | 'destructive';
}>;

function OpenUiButtonRenderer({ props }: ButtonRendererProps) {
  const triggerAction = useTriggerAction();
  const isStreaming = useIsStreaming();
  const disabledField = useStateField(`__button_disabled__:${props.id}`, props.disabled);

  return (
    <ButtonUI
      disabled={isStreaming || Boolean(disabledField.value)}
      style={getHexColorStyle({ background: props.background })}
      variant={props.variant}
      onClick={() => {
        void triggerAction(props.label, undefined, props.action as never);
      }}
    >
      <span style={getHexColorStyle({ color: props.color })}>{props.label}</span>
    </ButtonUI>
  );
}

export const ButtonComponent = defineComponent({
  name: 'Button',
  description:
    'Clickable action trigger. The first argument must be a stable id string, followed by the visible label. Action([...]) runs steps in order, so one button can combine multiple @Run, @Set, @Reset, or @ToAssistant steps.',
  props: z.object({
    id: z.string().describe('Stable action and state key. Required first argument.'),
    label: z.string().describe('Visible button label.'),
    variant: variantSchema.describe('Visual style: default, secondary, or destructive.'),
    action: z.unknown().optional().describe('Usually Action([...]) with one or more @Run, @Set, @Reset, or @ToAssistant steps executed in order.'),
    disabled: reactive(z.boolean().optional().default(false).describe('Whether the button is disabled.')),
    ...hexColorOverrideProps,
  }),
  component: OpenUiButtonRenderer,
});
