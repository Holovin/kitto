import { defineComponent, reactive, useIsStreaming, useStateField, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { Checkbox as CheckboxUI } from '@components/ui/checkbox';
import { z } from 'zod';
import { nullableTextSchema } from './shared';

type CheckboxRendererProps = ComponentRenderProps<{
  checked: StateField<boolean | undefined>;
  helper?: string | null;
  label: string;
  name: string;
}>;

function OpenUiCheckboxRenderer({ props }: CheckboxRendererProps) {
  const isStreaming = useIsStreaming();
  const field = useStateField(props.name, props.checked);
  const hasLabel = props.label.trim().length > 0;
  const hasHelper = Boolean(props.helper?.trim());

  if (!hasLabel && !hasHelper) {
    return (
      <div className="flex h-5 items-center">
        <CheckboxUI
          checked={Boolean(field.value)}
          disabled={isStreaming}
          onCheckedChange={(checked: boolean | 'indeterminate') => field.setValue(Boolean(checked))}
        />
      </div>
    );
  }

  return (
    <label className="flex items-start gap-3 rounded-[1.25rem] border border-slate-200 bg-white px-4 py-3">
      <CheckboxUI
        checked={Boolean(field.value)}
        disabled={isStreaming}
        onCheckedChange={(checked: boolean | 'indeterminate') => field.setValue(Boolean(checked))}
      />
      <span className="flex flex-col gap-1">
        {hasLabel ? <span className="text-sm font-medium text-slate-900">{props.label}</span> : null}
        {hasHelper ? <span className="text-xs text-slate-500">{props.helper}</span> : null}
      </span>
    </label>
  );
}

export const CheckboxComponent = defineComponent({
  name: 'Checkbox',
  description: 'Boolean toggle. Bind checked to a $variable when the user should control visibility or confirmation state.',
  props: z.object({
    name: z.string().describe('Stable field name used for persistence and bindings.'),
    label: z.string().describe('Visible label shown next to the checkbox.'),
    checked: reactive(z.boolean().optional().describe('Current checked state, often bound to a $variable.')),
    helper: nullableTextSchema.describe('Small helper copy shown below the checkbox label.'),
  }),
  component: OpenUiCheckboxRenderer,
});
