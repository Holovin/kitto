import { defineComponent } from '@openuidev/react-lang';
import { z } from 'zod';
import { nullableTextSchema } from './shared';

export const AppShellComponent = defineComponent({
  name: 'AppShell',
  description: 'Root container for the generated app. Use it once as the root statement and pass Screen children.',
  props: z.object({
    title: nullableTextSchema.describe('Primary heading for the generated app shell.'),
    children: z.array(z.unknown()).default([]).describe('Screen or Group children rendered inside the shell.'),
  }),
  component: ({ props, renderNode }) => (
    <div className="flex flex-col gap-2 rounded-[1.5rem] border border-white/70 bg-white/95 p-4 shadow-[0_30px_100px_-48px_rgba(15,23,42,0.45)]">
      {props.title ? <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{props.title}</h1> : null}
      <div className="flex flex-col gap-2">{renderNode(props.children)}</div>
    </div>
  ),
});
