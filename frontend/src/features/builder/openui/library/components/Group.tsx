import { defineComponent } from '@openuidev/react-lang';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card';
import { cn } from '@lib/utils';
import { z } from 'zod';
import { nullableTextSchema } from './shared';

const directionSchema = z.enum(['vertical', 'horizontal', 'grid']).default('vertical');

const layoutClassNames: Record<z.infer<typeof directionSchema>, string> = {
  vertical: 'flex flex-col gap-4',
  horizontal: 'flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end',
  grid: 'grid gap-4 md:grid-cols-2',
};

export const GroupComponent = defineComponent({
  name: 'Group',
  description:
    'Local layout container for related controls or content. Use vertical for stacked sections, horizontal for inline actions, grid for two-column layouts.',
  props: z.object({
    title: nullableTextSchema.describe('Optional section title shown above the group content.'),
    description: nullableTextSchema.describe('Optional helper copy for the group.'),
    direction: directionSchema.describe('Layout direction for the children: vertical, horizontal, or grid.'),
    children: z.array(z.unknown()).default([]).describe('Child nodes rendered inside the group.'),
  }),
  component: ({ props, renderNode }) => (
    <Card className="border-slate-200/70 bg-slate-50/80 shadow-none">
      {props.title || props.description ? (
        <CardHeader className="pb-4">
          {props.title ? <CardTitle className="text-base">{props.title}</CardTitle> : null}
          {props.description ? <CardDescription>{props.description}</CardDescription> : null}
        </CardHeader>
      ) : null}
      <CardContent className={cn(layoutClassNames[props.direction], props.title || props.description ? '' : 'pt-6')}>
        {renderNode(props.children)}
      </CardContent>
    </Card>
  ),
});
