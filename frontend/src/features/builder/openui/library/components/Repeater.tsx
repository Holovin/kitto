import { Children } from 'react';
import { defineComponent } from '@openuidev/react-lang';
import { z } from 'zod';
import { nullableTextSchema } from './shared';

export const RepeaterComponent = defineComponent({
  name: 'Repeater',
  description:
    'Collection container. Pass an array of rows, usually created with @Each(...), and it will render them as a vertical list.',
  props: z.object({
    children: z.array(z.unknown()).default([]).describe('Repeated rows or cards, often produced by @Each(...).'),
    emptyText: nullableTextSchema.describe('Fallback message when the repeated list is empty.'),
  }),
  component: ({ props, renderNode }) => {
    const renderedChildren = Children.toArray(renderNode(props.children));

    if (renderedChildren.length === 0) {
      return (
        <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
          {props.emptyText ?? 'Nothing to show yet.'}
        </div>
      );
    }

    return <div className="flex flex-col gap-3">{renderedChildren}</div>;
  },
});
