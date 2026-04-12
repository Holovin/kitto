import { defineComponent, reactive, useIsStreaming, useStateField, useTriggerAction, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { Button as ButtonUI } from '@components/ui/button';
import { z } from 'zod';

const variantSchema = z.enum(['default', 'secondary', 'ghost', 'destructive']).default('default');

type ButtonRendererProps = ComponentRenderProps<{
  action?: unknown;
  disabled?: StateField<boolean>;
  label: string;
  variant: 'default' | 'secondary' | 'ghost' | 'destructive';
}>;

function OpenUiButtonRenderer({ props }: ButtonRendererProps) {
  const triggerAction = useTriggerAction();
  const isStreaming = useIsStreaming();
  const disabledField = useStateField(`__button_disabled__${props.label}`, props.disabled);

  return (
    <ButtonUI
      disabled={isStreaming || Boolean(disabledField.value)}
      variant={props.variant}
      onClick={() => {
        void triggerAction(props.label, undefined, props.action as never);
      }}
    >
      {props.label}
    </ButtonUI>
  );
}

export const ButtonComponent = defineComponent({
  name: 'Button',
  description:
    'Clickable action trigger. Use Action([...]) for local state, Query re-fetches, Mutation runs, or @OpenUrl steps.',
  props: z.object({
    label: z.string().describe('Visible button label.'),
    variant: variantSchema.describe('Visual style: default, secondary, ghost, or destructive.'),
    action: z.unknown().optional().describe('Usually Action([...]) with @Run, @Set, @Reset, or @OpenUrl steps.'),
    disabled: reactive(z.boolean().optional().default(false).describe('Whether the button is disabled.')),
  }),
  component: OpenUiButtonRenderer,
});
