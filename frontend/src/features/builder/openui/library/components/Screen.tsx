import type { ReactNode } from 'react';
import { defineComponent } from '@openuidev/react-lang';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { z } from 'zod';

function ScreenRenderer({
  props,
  renderNode,
}: {
  props: { children: unknown[]; id: string; isActive?: boolean; title: string };
  renderNode: (value: unknown) => ReactNode;
}) {
  if (props.isActive === false) {
    return null;
  }

  return (
    <Card data-screen={props.id}>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent>{renderNode(props.children)}</CardContent>
    </Card>
  );
}

export const ScreenComponent = defineComponent({
  name: 'Screen',
  description: 'Screen-level section. Omit isActive for always-visible screens, or pass a boolean expression to control visibility.',
  props: z.object({
    id: z.string().describe('Stable screen identifier such as intro, form, results, or summary.'),
    title: z.string().describe('Visible heading for this screen. Required.'),
    children: z.array(z.unknown()).default([]).describe('Content groups and controls for the screen.'),
    isActive: z
      .boolean()
      .optional()
      .describe('Optional visibility gate. When false the screen is hidden; when omitted the screen renders normally.'),
  }),
  component: ScreenRenderer,
});
