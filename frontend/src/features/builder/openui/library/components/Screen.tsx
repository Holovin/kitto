import type { ReactNode } from 'react';
import { defineComponent } from '@openuidev/react-lang';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card';
import { z } from 'zod';
import { useCurrentScreenId } from '@features/builder/openui/runtime/navigationContext';
import { nullableTextSchema } from './shared';

function ScreenRenderer({
  props,
  renderNode,
}: {
  props: { children: unknown[]; id: string; isActive?: boolean; title?: string | null };
  renderNode: (value: unknown) => ReactNode;
}) {
  const currentScreenId = useCurrentScreenId();
  const isActive = props.isActive ?? (currentScreenId ? props.id === currentScreenId : true);

  if (!isActive) {
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
}

export const ScreenComponent = defineComponent({
  name: 'Screen',
  description:
    'Screen-level section. Explicit isActive overrides navigation; when isActive is omitted, the screen follows persisted navigation.currentScreenId.',
  props: z.object({
    id: z.string().describe('Stable screen identifier such as intro, form, results, or summary.'),
    title: nullableTextSchema.describe('Visible heading for this screen.'),
    isActive: z
      .boolean()
      .optional()
      .describe(
        'Optional explicit visibility override. When omitted, Screen renders when id matches navigation.currentScreenId; when no current screen exists yet, every Screen stays visible.',
      ),
    children: z.array(z.unknown()).default([]).describe('Content groups and controls for the screen.'),
  }),
  component: ScreenRenderer,
});
