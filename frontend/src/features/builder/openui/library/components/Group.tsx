import { defineComponent } from '@openuidev/react-lang';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { cn } from '@lib/utils';
import { z } from 'zod';
import { nullableTextSchema } from './shared';

const directionSchema = z.enum(['vertical', 'horizontal']).default('vertical');
const variantSchema = z.enum(['block', 'inline']).default('block');

const layoutClassNames: Record<z.infer<typeof variantSchema>, Record<z.infer<typeof directionSchema>, string>> = {
  block: {
    vertical: 'flex flex-col gap-4',
    horizontal: 'flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end',
  },
  inline: {
    vertical: 'flex flex-col gap-3',
    horizontal: 'flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end',
  },
};

export const GroupComponent = defineComponent({
  name: 'Group',
  description:
    'Local layout container for related controls or content. Use variant "block" for standalone sections and variant "inline" for lightweight nested groups, repeated rows, or inline controls.',
  props: z.object({
    title: nullableTextSchema.describe('Optional section title shown above the group content.'),
    direction: directionSchema.describe('Layout direction for the children: vertical or horizontal.'),
    children: z.array(z.unknown()).default([]).describe('Child nodes rendered inside the group.'),
    variant: variantSchema.describe('Visual weight: block for card-like sections, or inline for lightweight nested layout.'),
  }),
  component: ({ props, renderNode }) => {
    if (props.variant === 'inline') {
      return (
        <div className="flex flex-col gap-3">
          {props.title ? <div className="text-sm font-medium leading-6 text-slate-700">{props.title}</div> : null}
          <div className={layoutClassNames.inline[props.direction]}>{renderNode(props.children)}</div>
        </div>
      );
    }

    return (
      <Card className="border-slate-200/70 bg-slate-50/80 shadow-none">
        {props.title ? (
          <CardHeader className="pb-4">
            <CardTitle className="text-base">{props.title}</CardTitle>
          </CardHeader>
        ) : null}
        <CardContent className={cn(layoutClassNames.block[props.direction], props.title ? '' : 'pt-6')}>
          {renderNode(props.children)}
        </CardContent>
      </Card>
    );
  },
});
