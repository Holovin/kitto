import { defineComponent, reactive, useIsStreaming, useStateField, useTriggerAction, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { Button as ButtonUI } from '@components/ui/button';
import { z } from 'zod';

const variantSchema = z.enum(['default', 'secondary', 'ghost', 'destructive']).default('default');

type ButtonRendererProps = ComponentRenderProps<{
  action?: unknown;
  disabled?: StateField<boolean>;
  id?: string;
  label: string;
  variant: 'default' | 'secondary' | 'ghost' | 'destructive';
}>;

function OpenUiButtonRenderer({ props }: ButtonRendererProps) {
  const triggerAction = useTriggerAction();
  const isStreaming = useIsStreaming();
  const actionKey = props.id ?? props.label;
  const disabledField = useStateField(`__button_disabled__:${actionKey}`, props.disabled);

  return (
    <ButtonUI
      disabled={isStreaming || Boolean(disabledField.value)}
      variant={props.variant}
      onClick={() => {
        void triggerAction(actionKey, undefined, props.action as never);
      }}
    >
      {props.label}
    </ButtonUI>
  );
}

export const ButtonComponent = defineComponent({
  name: 'Button',
  description:
    'Clickable action trigger. Use Action([...]) with @Run, @Set, @Reset, or @ToAssistant steps. Provide a stable id when buttons share the same label.',
  props: z.object({
    label: z.string().describe('Visible button label.'),
    variant: variantSchema.describe('Visual style: default, secondary, ghost, or destructive.'),
    action: z.unknown().optional().describe('Usually Action([...]) with @Run, @Set, @Reset, or @ToAssistant steps.'),
    disabled: reactive(z.boolean().optional().default(false).describe('Whether the button is disabled.')),
    id: z.string().optional().describe('Stable optional action/state key. Provide it when buttons share the same label.'),
  }),
  component: OpenUiButtonRenderer,
});
