import type { ReactNode } from 'react';
import { defineComponent } from '@openuidev/react-lang';
import { cn } from '@lib/utils';
import { z } from 'zod';
import { KittoAppearanceProvider, appearanceSchema, getAppearanceStyle, useKittoAppearanceScope } from './shared';

function AppShellRenderer({
  props,
  renderNode,
}: {
  props: { appearance?: { bgColor?: string; textColor?: string }; children: unknown[] };
  renderNode: (value: unknown) => ReactNode;
}) {
  const appearanceScope = useKittoAppearanceScope();
  const shellStyle = getAppearanceStyle({
    appearance: props.appearance,
    applyTextColor: true,
    applyBackgroundColor: true,
    hasInheritedTextColor: appearanceScope.hasTextColor,
    hasInheritedBgColor: appearanceScope.hasBgColor,
  });

  return (
    <KittoAppearanceProvider appearance={props.appearance}>
      <div
        className={cn('flex min-h-full flex-col gap-6', props.appearance?.bgColor ? 'rounded-[1.75rem] p-4' : '')}
        data-app-shell="true"
        style={shellStyle}
      >
        {renderNode(props.children)}
      </div>
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
