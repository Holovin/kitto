import { defineComponent, type ComponentRenderProps } from '@openuidev/react-lang';
import { parseSafeUrl } from '@pages/Chat/builder/openui/runtime/safeUrl';
import { z } from 'zod';
import { appearanceSchema, getAppearanceStyle, useKittoAppearanceScope } from './shared';

type LinkRendererProps = ComponentRenderProps<{
  appearance?: { contrastColor?: string; mainColor?: string };
  label: string;
  newTab: boolean;
  url: string;
}>;

function OpenUiLinkRenderer({ props }: LinkRendererProps) {
  const safeUrl = parseSafeUrl(props.url);
  const appearanceScope = useKittoAppearanceScope();
  const linkStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    backgroundRole: 'main',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
    hasInheritedMainColor: appearanceScope.hasMainColor,
  });

  if (!safeUrl) {
    return (
      <span
        aria-disabled="true"
        className="inline-flex w-fit cursor-not-allowed items-center text-sm font-semibold text-slate-400 opacity-80"
        style={linkStyle}
      >
        {props.label}
      </span>
    );
  }

  return (
    <a
      className="inline-flex w-fit items-center text-sm font-semibold text-sky-700 underline decoration-sky-300 underline-offset-4 transition hover:text-sky-800"
      href={safeUrl}
      rel={props.newTab ? 'noopener noreferrer' : undefined}
      style={linkStyle}
      target={props.newTab ? '_blank' : undefined}
    >
      {props.label}
    </a>
  );
}

export const LinkComponent = defineComponent({
  name: 'Link',
  description: 'Text link for navigation to an external URL or a known browser route.',
  props: z.object({
    label: z.string().describe('Visible link label.'),
    url: z.string().describe('Destination URL or route.'),
    newTab: z.boolean().optional().default(true).describe('Open in a new tab when true.'),
    appearance: appearanceSchema,
  }),
  component: OpenUiLinkRenderer,
});
