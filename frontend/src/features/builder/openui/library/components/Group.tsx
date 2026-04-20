import { defineComponent } from '@openuidev/react-lang';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { cn } from '@lib/utils';
import { z } from 'zod';
import { getHexColorStyle, hexColorOverrideProps, nullableTextSchema } from './shared';

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
    ...hexColorOverrideProps,
  }),
  component: ({ props, renderNode }) => {
    if (props.variant === 'inline') {
      return (
        <div className="flex flex-col gap-3" style={getHexColorStyle({ background: props.background })}>
          {props.title ? (
            <div className="text-sm font-medium leading-6 text-slate-700" style={getHexColorStyle({ color: props.color })}>
              {props.title}
            </div>
          ) : null}
          <div className={layoutClassNames.inline[props.direction]}>{renderNode(props.children)}</div>
        </div>
      );
    }

    return (
      <Card className="border-slate-200/70 bg-slate-50/80 shadow-none" style={getHexColorStyle({ background: props.background })}>
        {props.title ? (
          <CardHeader className="pb-4">
            <CardTitle className="text-base" style={getHexColorStyle({ color: props.color })}>
              {props.title}
            </CardTitle>
          </CardHeader>
        ) : null}
        <CardContent className={cn(layoutClassNames.block[props.direction], props.title ? '' : 'pt-6')} style={getHexColorStyle({ color: props.color })}>
          {renderNode(props.children)}
        </CardContent>
      </Card>
    );
  },
});
