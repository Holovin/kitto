import { defineComponent } from '@openuidev/react-lang';
import { z } from 'zod';

export const AppShellComponent = defineComponent({
  name: 'AppShell',
  description: 'Technical root wrapper for the generated app. Use it once as root; it renders children without any visual chrome.',
  props: z.object({
    children: z.array(z.unknown()).default([]).describe('Screen or Group children rendered inside the shell.'),
  }),
  component: ({ props, renderNode }) => <>{renderNode(props.children)}</>,
});
