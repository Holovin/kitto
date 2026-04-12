import { defineComponent } from '@openuidev/react-lang';
import { z } from 'zod';

export const LinkComponent = defineComponent({
  name: 'Link',
  description: 'Text link for navigation to an external URL or a known browser route.',
  props: z.object({
    label: z.string().describe('Visible link label.'),
    url: z.string().describe('Destination URL or route.'),
    newTab: z.boolean().optional().default(true).describe('Open in a new tab when true.'),
  }),
  component: ({ props }) => (
    <a
      className="inline-flex w-fit items-center text-sm font-semibold text-sky-700 underline decoration-sky-300 underline-offset-4 transition hover:text-sky-800"
      href={props.url}
      rel={props.newTab ? 'noopener noreferrer' : undefined}
      target={props.newTab ? '_blank' : undefined}
    >
      {props.label}
    </a>
  ),
});
