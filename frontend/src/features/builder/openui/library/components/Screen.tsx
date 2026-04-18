import type { ReactNode } from 'react';
import { defineComponent } from '@openuidev/react-lang';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { z } from 'zod';
import { useCurrentScreenId } from '@features/builder/openui/runtime/navigationContext';

function ScreenRenderer({
  props,
  renderNode,
}: {
  props: { children: unknown[]; id: string; isActive?: boolean; title: string };
  renderNode: (value: unknown) => ReactNode;
}) {
  const currentScreenId = useCurrentScreenId();
  const isActive = props.isActive ?? (currentScreenId ? props.id === currentScreenId : true);

  if (!isActive) {
    return null;
  }

  return (
    <Card className="border-slate-200/80 bg-white">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl">{props.title}</CardTitle>
      </CardHeader>
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
    title: z.string().describe('Visible heading for this screen. Required.'),
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
