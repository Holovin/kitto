import type { ReactNode } from 'react';
import { defineComponent } from '@openuidev/react-lang';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { z } from 'zod';
import { KittoAppearanceProvider, KittoValidationInteractionProvider, appearanceSchema, getAppearanceStyle, useKittoAppearanceScope } from './shared';

function ScreenRenderer({
  props,
  renderNode,
}: {
  props: { appearance?: { contrastColor?: string; mainColor?: string }; children: unknown[]; id: string; isActive?: boolean; title: string };
  renderNode: (value: unknown) => ReactNode;
}) {
  const appearanceScope = useKittoAppearanceScope();

  if (props.isActive === false) {
    return null;
  }

  const screenStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    backgroundRole: 'main',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
    hasInheritedMainColor: appearanceScope.hasMainColor,
  });
  const titleStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
  });

  return (
    <KittoAppearanceProvider appearance={props.appearance}>
      <KittoValidationInteractionProvider>
        <Card data-screen={props.id} style={screenStyle}>
          <CardHeader>
            <CardTitle style={titleStyle}>{props.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">{renderNode(props.children)}</CardContent>
        </Card>
      </KittoValidationInteractionProvider>
    </KittoAppearanceProvider>
  );
}

export const ScreenComponent = defineComponent({
  name: 'Screen',
  description:
    'Screen-level section. Omit isActive for always-visible screens, or pass a boolean expression to control visibility. Optional appearance overrides theme colors for the whole screen subtree.',
  props: z.object({
    id: z.string().describe('Stable screen identifier such as intro, form, results, or summary.'),
    title: z.string().describe('Visible heading for this screen. Required.'),
    children: z.array(z.unknown()).default([]).describe('Content groups and controls for the screen.'),
    isActive: z
      .boolean()
      .optional()
      .describe('Optional visibility gate. When false the screen is hidden; when omitted the screen renders normally.'),
    appearance: appearanceSchema,
  }),
  component: ScreenRenderer,
});
