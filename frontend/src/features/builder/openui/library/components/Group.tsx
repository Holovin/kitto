import { defineComponent } from '@openuidev/react-lang';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { cn } from '@lib/utils';
import { z } from 'zod';
import { nullableTextSchema } from './shared';

const directionSchema = z.enum(['vertical', 'horizontal']).default('vertical');

const layoutClassNames: Record<z.infer<typeof directionSchema>, string> = {
  vertical: 'flex flex-col gap-4',
  horizontal: 'flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end',
};

export const GroupComponent = defineComponent({
  name: 'Group',
  description:
    'Local layout container for related controls or content. Use vertical for stacked sections and horizontal for inline actions.',
  props: z.object({
    title: nullableTextSchema.describe('Optional section title shown above the group content.'),
    direction: directionSchema.describe('Layout direction for the children: vertical or horizontal.'),
    children: z.array(z.unknown()).default([]).describe('Child nodes rendered inside the group.'),
  }),
  component: ({ props, renderNode }) => (
    <Card className="border-slate-200/70 bg-slate-50/80 shadow-none">
      {props.title ? (
        <CardHeader className="pb-4">
          <CardTitle className="text-base">{props.title}</CardTitle>
        </CardHeader>
      ) : null}
      <CardContent className={cn(layoutClassNames[props.direction], props.title ? '' : 'pt-6')}>
        {renderNode(props.children)}
      </CardContent>
    </Card>
  ),
});
