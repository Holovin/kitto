import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import { z } from 'zod';

export const nullableTextSchema = z.union([z.string(), z.null()]).optional();
export const textValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]).optional();
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const hexColorSchema = z.string().regex(HEX_COLOR_PATTERN).optional();
const appearanceTextColorProp = hexColorSchema.describe('Optional text color override as #RRGGBB.');
const appearanceBackgroundColorProp = hexColorSchema.describe('Optional background color override as #RRGGBB.');

export const KITTO_TEXT_COLOR_VAR = '--kitto-text-color';
export const KITTO_BG_COLOR_VAR = '--kitto-bg-color';

export type KittoAppearance = {
  bgColor?: string;
  textColor?: string;
};

export type KittoTextAppearance = Pick<KittoAppearance, 'textColor'>;

export const appearanceSchema = z
  .object({
    textColor: appearanceTextColorProp,
    bgColor: appearanceBackgroundColorProp,
  })
  .strict()
  .optional()
  .describe('Optional appearance override with textColor and bgColor as #RRGGBB.');

export const textAppearanceSchema = z
  .object({
    textColor: appearanceTextColorProp,
  })
  .strict()
  .optional()
  .describe('Optional appearance override with textColor as #RRGGBB.');

export const choiceOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
});

type KittoAppearanceScope = {
  hasBgColor: boolean;
  hasTextColor: boolean;
};

const defaultKittoAppearanceScope: KittoAppearanceScope = {
  hasBgColor: false,
  hasTextColor: false,
};

const KittoAppearanceContext = createContext<KittoAppearanceScope>(defaultKittoAppearanceScope);

export function asDisplayText(value: unknown) {
  if (value == null) {
    return '';
  }

  return String(value);
}

export function isStrictHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

function hasBackgroundColorProp(appearance?: KittoAppearance | KittoTextAppearance): appearance is KittoAppearance {
  return typeof appearance === 'object' && appearance !== null && 'bgColor' in appearance;
}

function setCssVariable(style: CSSProperties, variableName: string, value: string) {
  (style as Record<string, string>)[variableName] = value;
}

export function useKittoAppearanceScope() {
  return useContext(KittoAppearanceContext);
}

export function KittoAppearanceProvider({
  appearance,
  children,
}: {
  appearance?: KittoAppearance | KittoTextAppearance;
  children: ReactNode;
}) {
  const parentScope = useKittoAppearanceScope();
  const scope: KittoAppearanceScope = {
    hasTextColor: parentScope.hasTextColor || isStrictHexColor(appearance?.textColor),
    hasBgColor:
      parentScope.hasBgColor || (hasBackgroundColorProp(appearance) && isStrictHexColor(appearance.bgColor)),
  };

  return <KittoAppearanceContext.Provider value={scope}>{children}</KittoAppearanceContext.Provider>;
}

export function getAppearanceStyle({
  appearance,
  applyTextColor = false,
  applyBackgroundColor = false,
  hasInheritedTextColor = false,
  hasInheritedBgColor = false,
}: {
  appearance?: KittoAppearance | KittoTextAppearance;
  applyTextColor?: boolean;
  applyBackgroundColor?: boolean;
  hasInheritedTextColor?: boolean;
  hasInheritedBgColor?: boolean;
}): CSSProperties | undefined {
  const style: CSSProperties = {};
  const safeTextColor = isStrictHexColor(appearance?.textColor) ? appearance.textColor : undefined;
  const safeBgColor =
    hasBackgroundColorProp(appearance) && isStrictHexColor(appearance.bgColor) ? appearance.bgColor : undefined;

  if (safeTextColor) {
    setCssVariable(style, KITTO_TEXT_COLOR_VAR, safeTextColor);
  }

  if (safeBgColor) {
    setCssVariable(style, KITTO_BG_COLOR_VAR, safeBgColor);
  }

  if (applyTextColor && (safeTextColor || hasInheritedTextColor)) {
    style.color = `var(${KITTO_TEXT_COLOR_VAR})`;
  }

  if (applyBackgroundColor && (safeBgColor || hasInheritedBgColor)) {
    style.backgroundColor = `var(${KITTO_BG_COLOR_VAR})`;
  }

  return Object.keys(style).length > 0 ? style : undefined;
}
