import type { ReactNode } from 'react';
import { defineRegistry, useStateValue } from '@json-render/react';
import { addByPath, getByPath, removeByPath, setByPath } from '@json-render/core';
import { shadcnComponents } from '@json-render/shadcn';
import { cn } from '@lib/utils';
import { builderCatalog } from '../catalog';

function cloneStateModel(prev: Record<string, unknown>) {
  return structuredClone(prev) as Record<string, unknown>;
}

function setStateAtPath(prev: Record<string, unknown>, path: string, value: unknown) {
  if (path === '/' || path === '') {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : prev;
  }

  const next = cloneStateModel(prev);
  setByPath(next, path, value);
  return next;
}

function mutateStateAtPath(
  prev: Record<string, unknown>,
  path: string,
  mutator: (draft: Record<string, unknown>, safePath: string) => void,
) {
  const next = cloneStateModel(prev);
  mutator(next, path);
  return next;
}

function hasRenderableChildren(children: ReactNode) {
  return Array.isArray(children) ? children.some(Boolean) : Boolean(children);
}

function getSafeNavigationUrl(url: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export const builderRegistry = defineRegistry(builderCatalog, {
  components: {
    AppShell: ({ props, children }) => (
      <div className="w-full rounded-[2rem] border border-border/60 bg-card/85 p-6 shadow-lg shadow-slate-900/5 md:p-8">
        {props.title ? <h2 className="font-serif text-2xl text-foreground">{props.title}</h2> : null}
        {props.description ? <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{props.description}</p> : null}
        <div className={cn('mt-6 space-y-6', !props.title && !props.description && 'mt-0')}>{children}</div>
      </div>
    ),
    Screen: ({ props, children }) => {
      const currentScreen = useStateValue<string>('/ui/currentScreen');

      if (currentScreen && currentScreen !== props.screenId) {
        return null;
      }

      return (
        <section className="w-full space-y-4">
          {props.title ? <h3 className="font-serif text-xl text-foreground">{props.title}</h3> : null}
          {props.description ? <p className="text-sm text-muted-foreground">{props.description}</p> : null}
          <div className="space-y-4">{children}</div>
        </section>
      );
    },
    Group: ({ props, children }) => {
      const direction = props.direction ?? 'vertical';
      const gapMap: Record<string, string> = {
        none: 'gap-0',
        sm: 'gap-2',
        md: 'gap-4',
        lg: 'gap-6',
        xl: 'gap-8',
      };
      const alignMap: Record<string, string> = {
        start: 'items-start',
        center: 'items-center',
        end: 'items-end',
        stretch: 'items-stretch',
      };

      return (
        <div
          className={cn(
            'flex',
            direction === 'horizontal' ? 'flex-row flex-wrap' : 'flex-col',
            gapMap[props.gap ?? 'md'],
            alignMap[props.align ?? 'stretch'],
            props.className,
          )}
        >
          {children}
        </div>
      );
    },
    Repeater: ({ props, children }) => (
      <div className={cn('space-y-4', props.className)}>
        {hasRenderableChildren(children) ? children : props.emptyText ? <p className="text-sm text-muted-foreground">{props.emptyText}</p> : null}
      </div>
    ),
    Text: shadcnComponents.Text,
    Input: shadcnComponents.Input,
    TextArea: shadcnComponents.Textarea,
    Checkbox: shadcnComponents.Checkbox,
    RadioGroup: shadcnComponents.Radio,
    Select: shadcnComponents.Select,
    Button: shadcnComponents.Button,
    Link: ({ props, on }) => {
      // Prefer the documented Link event and keep a press fallback for older specs.
      const click = on('click');
      const press = on('press');
      const eventHandle = click.bound ? click : press;

      return (
        <a
          href={props.href ?? '#'}
          className="text-primary underline-offset-4 hover:underline text-sm font-medium"
          onClick={(event) => {
            if (eventHandle.shouldPreventDefault) {
              event.preventDefault();
            }
            eventHandle.emit();
          }}
        >
          {props.label}
        </a>
      );
    },
  },
  actions: {
    read_state: async (params, setState, state) => {
      if (!params) {
        return;
      }
      const value = getByPath(state, params.path) ?? params.fallback ?? null;
      setState((prev) => setStateAtPath(prev, params.targetPath, value));
    },
    write_state: async (params, setState) => {
      if (!params) {
        return;
      }
      setState((prev) => setStateAtPath(prev, params.path, params.value));
    },
    merge_state: async (params, setState, state) => {
      if (!params) {
        return;
      }
      const currentValue = getByPath(state, params.path);
      const currentRecord =
        typeof currentValue === 'object' && currentValue !== null && !Array.isArray(currentValue)
          ? (currentValue as Record<string, unknown>)
          : {};

      setState((prev) => setStateAtPath(prev, params.path, { ...currentRecord, ...params.patch }));
    },
    append_state: async (params, setState) => {
      if (!params) {
        return;
      }
      setState((prev) =>
        mutateStateAtPath(prev, params.path, (draft, safePath) => {
          addByPath(draft, safePath, params.value);
        }),
      );
    },
    remove_state: async (params, setState) => {
      if (!params) {
        return;
      }
      setState((prev) =>
        mutateStateAtPath(prev, `${params.path}/${params.index}`, (draft, safePath) => {
          removeByPath(draft, safePath);
        }),
      );
    },
    open_url: async (params) => {
      if (!params) {
        return;
      }
      const safeUrl = getSafeNavigationUrl(params.url);

      if (!safeUrl) {
        return;
      }

      window.open(safeUrl, '_blank', 'noopener,noreferrer');
    },
    navigate_screen: async (params, setState) => {
      if (!params) {
        return;
      }
      setState((prev) => setStateAtPath(prev, '/ui/currentScreen', params.screenId));
    },
  },
});
