import { defineCatalog } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { shadcnComponentDefinitions } from '@json-render/shadcn/catalog';
import { z } from 'zod';

const stackLikeProps = {
  direction: z.enum(['vertical', 'horizontal']).nullable(),
  gap: z.enum(['none', 'sm', 'md', 'lg', 'xl']).nullable(),
  align: z.enum(['start', 'center', 'end', 'stretch']).nullable(),
  className: z.string().nullable(),
};

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value, 'https://builder.local');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export const builderCatalog = defineCatalog(schema, {
  components: {
    AppShell: {
      props: z.object({
        title: z.string().nullable(),
        description: z.string().nullable(),
      }),
      slots: ['default'],
      description: 'Top-level generated app container.',
    },
    Screen: {
      props: z.object({
        screenId: z.string(),
        title: z.string().nullable(),
        description: z.string().nullable(),
      }),
      slots: ['default'],
      description: 'Logical screen. The runtime shows the screen that matches /ui/currentScreen.',
    },
    Group: {
      props: z.object(stackLikeProps),
      slots: ['default'],
      description: 'Flexible layout group for arranging children vertically or horizontally.',
    },
    Repeater: {
      props: z.object({
        emptyText: z.string().nullable(),
        className: z.string().nullable(),
      }),
      slots: ['default'],
      description: 'Container for repeated children. Put repeat.statePath on the element to repeat over an array.',
    },
    Text: shadcnComponentDefinitions.Text,
    Input: shadcnComponentDefinitions.Input,
    TextArea: {
      ...shadcnComponentDefinitions.Textarea,
      description: 'Multi-line textarea with optional $bindState value.',
    },
    Checkbox: shadcnComponentDefinitions.Checkbox,
    RadioGroup: {
      ...shadcnComponentDefinitions.Radio,
      description: 'Radio group with options and a $bindState value.',
    },
    Select: shadcnComponentDefinitions.Select,
    Button: shadcnComponentDefinitions.Button,
    Link: shadcnComponentDefinitions.Link,
  },
  actions: {
    read_state: {
      params: z.object({
        path: z.string(),
        targetPath: z.string(),
        fallback: z.unknown().optional(),
      }),
      description: 'Read a value from state and store it in another state path.',
    },
    write_state: {
      params: z.object({
        path: z.string(),
        value: z.unknown(),
      }),
      description: 'Write a value into state.',
    },
    merge_state: {
      params: z.object({
        path: z.string(),
        patch: z.record(z.string(), z.unknown()),
      }),
      description: 'Shallow-merge a patch object into state.',
    },
    append_state: {
      params: z.object({
        path: z.string(),
        value: z.unknown(),
      }),
      description: 'Append a value to an array in state.',
    },
    remove_state: {
      params: z.object({
        path: z.string(),
        index: z.number().int().nonnegative(),
      }),
      description: 'Remove an array item by index.',
    },
    open_url: {
      params: z.object({
        url: z.string().min(1).refine(isHttpUrl, 'URL must use the http or https scheme.'),
      }),
      description: 'Open a URL in a new browser tab.',
    },
    navigate_screen: {
      params: z.object({
        screenId: z.string(),
      }),
      description: 'Set /ui/currentScreen and show the matching Screen.',
    },
  },
});
