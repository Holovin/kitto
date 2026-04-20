import { Children } from 'react';
import { defineComponent } from '@openuidev/react-lang';
import { z } from 'zod';
import { nullableTextSchema } from './shared';

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
  }),
  component: ({ props, renderNode }) => {
    const renderedChildren = Children.toArray(renderNode(props.children));

    const content =
      renderedChildren.length === 0 ? (
        <div className="text-sm text-current opacity-80">
          {props.emptyText ?? 'Nothing to show yet.'}
        </div>
      ) : (
        renderedChildren
      );

    return <div className="flex flex-col gap-3">{content}</div>;
  },
});
