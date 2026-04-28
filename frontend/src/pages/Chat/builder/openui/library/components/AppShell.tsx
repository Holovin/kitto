import type { ReactNode } from 'react';
import type { ElementNode } from '@openuidev/react-lang';
import { defineComponent } from '@openuidev/react-lang';
import { cn } from '@helpers/utils';
import { z } from 'zod';
import {
  KittoAppearanceProvider,
  KittoValidationInteractionProvider,
  appearanceSchema,
  getAppearanceStyle,
  useKittoAppearanceScope,
} from './shared';

type ScreenElementNode = ElementNode & {
  typeName: 'Screen';
  props: ElementNode['props'] & { isActive?: boolean };
};

const EMPTY_CONTENT_MESSAGE =
  'The generated app currently has no visible content. Try asking Kitto to add a visible starting section.';

function isElementNode(value: unknown): value is ElementNode {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'element';
}

function isScreenNode(value: unknown): value is ScreenElementNode {
  return isElementNode(value) && value.typeName === 'Screen';
}

function hasNoVisibleContent(children: unknown[]) {
  if (children.length === 0) {
    return true;
  }

  return children.every((child) => isScreenNode(child) && child.props.isActive === false);
}

function AppShellRenderer({
  props,
  renderNode,
}: {
  props: { appearance?: { contrastColor?: string; mainColor?: string }; children: unknown[] };
  renderNode: (value: unknown) => ReactNode;
}) {
  const appearanceScope = useKittoAppearanceScope();
  const shellStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    backgroundRole: 'main',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
    hasInheritedMainColor: appearanceScope.hasMainColor,
  });

  return (
    <KittoAppearanceProvider appearance={props.appearance}>
      <KittoValidationInteractionProvider>
        <div
          className={cn('flex min-h-full flex-col gap-6', props.appearance?.mainColor && 'rounded-[1.75rem] p-4')}
          data-app-shell="true"
          style={shellStyle}
        >
          {renderNode(props.children)}
          {hasNoVisibleContent(props.children) ? (
            <div
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium leading-6 text-amber-950"
              data-empty-initial-render="true"
              role="status"
            >
              {EMPTY_CONTENT_MESSAGE}
            </div>
          ) : null}
        </div>
      </KittoValidationInteractionProvider>
    </KittoAppearanceProvider>
  );
}

export const AppShellComponent = defineComponent({
  name: 'AppShell',
  description: 'Technical root wrapper for the generated app. Use it once as root; optional appearance sets the global theme for all nested content.',
  props: z.object({
    children: z.array(z.unknown()).default([]).describe('Screen or Group children rendered inside the shell.'),
    appearance: appearanceSchema,
  }),
  component: AppShellRenderer,
});
