import { defineComponent } from '@openuidev/react-lang';
import { cn } from '@lib/utils';
import { z } from 'zod';
import { asDisplayText, getAppearanceStyle, textAppearanceSchema, textValueSchema, useKittoAppearanceScope } from './shared';

const variantSchema = z.enum(['body', 'code', 'muted', 'title']).default('body');
const alignSchema = z.enum(['start', 'center', 'end']).default('start');

const variantClassNames: Record<z.infer<typeof variantSchema>, string> = {
  body: 'text-sm leading-6 text-slate-700',
  code: 'rounded-xl bg-slate-900 px-3 py-2 font-mono text-xs text-slate-50',
  muted: 'text-sm leading-6 text-slate-500',
  title: 'text-lg font-semibold tracking-tight text-slate-950',
};

const alignClassNames: Record<z.infer<typeof alignSchema>, string> = {
  start: 'text-left',
  center: 'text-center',
  end: 'text-right',
};

function TextRenderer({
  props,
}: {
  props: {
    align: 'center' | 'end' | 'start';
    appearance?: { contrastColor?: string };
    value?: string | number | boolean | null;
    variant: 'body' | 'code' | 'muted' | 'title';
  };
}) {
  const appearanceScope = useKittoAppearanceScope();
  const textStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
  });

  return (
    <div className={cn(variantClassNames[props.variant], alignClassNames[props.align])} style={textStyle}>
      {asDisplayText(props.value)}
    </div>
  );
}

export const TextComponent = defineComponent({
  name: 'Text',
  description: 'Generic text node for headings, helper copy, code-style snippets, and status lines.',
  props: z.object({
    value: textValueSchema.describe('Text or expression result to display.'),
    variant: variantSchema.describe('Visual style: body, muted, title, or code.'),
    align: alignSchema.describe('Text alignment.'),
    appearance: textAppearanceSchema,
  }),
  component: TextRenderer,
});
