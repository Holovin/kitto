import { defineComponent } from '@openuidev/react-lang';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card';
import { z } from 'zod';
import { nullableTextSchema } from './shared';

export const ScreenComponent = defineComponent({
  name: 'Screen',
  description:
    'Screen-level section. Use it for major steps or pages inside the generated app and control visibility with isActive.',
  props: z.object({
    id: z.string().describe('Stable screen identifier such as intro, form, results, or summary.'),
    title: nullableTextSchema.describe('Visible heading for this screen.'),
    isActive: z.boolean().optional().default(true).describe('Whether the screen should currently render.'),
    children: z.array(z.unknown()).default([]).describe('Content groups and controls for the screen.'),
  }),
  component: ({ props, renderNode }) => {
    if (!props.isActive) {
      return null;
    }

    return (
      <Card className="border-slate-200/80 bg-white">
        {props.title ? (
          <CardHeader className="pb-4">
            <CardDescription className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Screen {props.id}
            </CardDescription>
            <CardTitle className="text-xl">{props.title}</CardTitle>
          </CardHeader>
        ) : null}
        <CardContent className="flex flex-col gap-4">{renderNode(props.children)}</CardContent>
      </Card>
    );
  },
});
