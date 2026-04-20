import { Children, type ReactNode } from 'react';
import { defineComponent } from '@openuidev/react-lang';
import { z } from 'zod';
import { KittoAppearanceProvider, appearanceSchema, getAppearanceStyle, nullableTextSchema, useKittoAppearanceScope } from './shared';

function RepeaterRenderer({
  props,
  renderNode,
}: {
  props: { appearance?: { contrastColor?: string; mainColor?: string }; children: unknown[]; emptyText?: string | null };
  renderNode: (value: unknown) => ReactNode;
}) {
  const appearanceScope = useKittoAppearanceScope();
  const renderedChildren = Children.toArray(renderNode(props.children));
  const repeaterStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    backgroundRole: 'main',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
    hasInheritedMainColor: appearanceScope.hasMainColor,
  });

  const content =
    renderedChildren.length === 0 ? (
      <div className="text-sm text-current opacity-80">
        {props.emptyText ?? 'Nothing to show yet.'}
      </div>
    ) : (
      renderedChildren
    );

  return (
    <KittoAppearanceProvider appearance={props.appearance}>
      <div className="flex flex-col gap-3" style={repeaterStyle}>
        {content}
      </div>
    </KittoAppearanceProvider>
  );
}

export const RepeaterComponent = defineComponent({
  name: 'Repeater',
  description:
    'Dynamic collection container. Pass an array of already-built row nodes and it renders them as a vertical list. Use @Each(collection, "item", rowNode) to build rows from local arrays, runtime state, or Query("read_state", ...) results. Do not hardcode repeated rows when the user asked for dynamic data.',
  props: z.object({
    children: z
      .array(z.unknown())
      .default([])
      .describe('Array of already-built row or card nodes, typically returned by @Each(collection, "item", ...).'),
    emptyText: nullableTextSchema.describe('Fallback message shown when the repeated rows array is empty.'),
    appearance: appearanceSchema,
  }),
  component: RepeaterRenderer,
});
