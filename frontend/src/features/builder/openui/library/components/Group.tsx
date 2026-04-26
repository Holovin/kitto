import type { ReactNode } from 'react';
import { defineComponent } from '@openuidev/react-lang';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { cn } from '@lib/utils';
import { z } from 'zod';
import { KittoAppearanceProvider, appearanceSchema, getAppearanceStyle, nullableTextSchema, useKittoAppearanceScope } from './shared';

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

function GroupRenderer({
  props,
  renderNode,
}: {
  props: {
    appearance?: { contrastColor?: string; mainColor?: string };
    children: unknown[];
    direction: 'horizontal' | 'vertical';
    title?: string | null;
    variant: 'block' | 'inline';
  };
  renderNode: (value: unknown) => ReactNode;
}) {
  const appearanceScope = useKittoAppearanceScope();

  const titleStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
  });

  if (props.variant === 'inline') {
    const inlineStyle = getAppearanceStyle({
      appearance: props.appearance,
      textRole: 'contrast',
      backgroundRole: props.appearance?.mainColor ? 'main' : undefined,
      hasInheritedContrastColor: appearanceScope.hasContrastColor,
    });

    return (
      <KittoAppearanceProvider appearance={props.appearance}>
        <div className="flex flex-col gap-3 rounded-xl p-3" style={inlineStyle}>
          {props.title ? (
            <div className="text-sm font-medium leading-6 text-slate-700" style={titleStyle}>
              {props.title}
            </div>
          ) : null}
          <div className={layoutClassNames.inline[props.direction]}>{renderNode(props.children)}</div>
        </div>
      </KittoAppearanceProvider>
    );
  }

  const blockStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    backgroundRole: 'main',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
    hasInheritedMainColor: appearanceScope.hasMainColor,
  });

  return (
    <KittoAppearanceProvider appearance={props.appearance}>
      <Card className="border-slate-200/70 bg-slate-50/80 shadow-none" style={blockStyle}>
        {props.title ? (
          <CardHeader className="pb-4">
            <CardTitle className="text-base" style={titleStyle}>
              {props.title}
            </CardTitle>
          </CardHeader>
        ) : null}
        <CardContent className={cn(layoutClassNames.block[props.direction], !props.title && 'pt-6')}>
          {renderNode(props.children)}
        </CardContent>
      </Card>
    </KittoAppearanceProvider>
  );
}

export const GroupComponent = defineComponent({
  name: 'Group',
  description:
    'Local layout container for related controls or content. Use variant "block" for standalone sections and variant "inline" for lightweight nested groups, repeated rows, or inline controls. Optional appearance overrides theme colors for the group subtree.',
  props: z.object({
    title: nullableTextSchema.describe('Optional section title shown above the group content.'),
    direction: directionSchema.describe('Layout direction for the children: vertical or horizontal.'),
    children: z.array(z.unknown()).default([]).describe('Child nodes rendered inside the group.'),
    variant: variantSchema.describe('Visual weight: block for card-like sections, or inline for lightweight nested layout.'),
    appearance: appearanceSchema,
  }),
  component: GroupRenderer,
});
