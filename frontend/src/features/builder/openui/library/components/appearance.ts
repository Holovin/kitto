import { createContext, createElement, useContext, type CSSProperties, type ReactNode } from 'react';
import { HEX_COLOR_PATTERN } from './schemas';

export const KITTO_MAIN_COLOR_VAR = '--kitto-main-color';
export const KITTO_CONTRAST_COLOR_VAR = '--kitto-contrast-color';

export type KittoAppearance = {
  contrastColor?: string;
  mainColor?: string;
};

export type KittoTextAppearance = {
  contrastColor?: string;
  mainColor?: never;
};

type KittoAppearanceScope = {
  hasContrastColor: boolean;
  hasMainColor: boolean;
};

const defaultKittoAppearanceScope: KittoAppearanceScope = {
  hasContrastColor: false,
  hasMainColor: false,
};

const KittoAppearanceContext = createContext<KittoAppearanceScope>(defaultKittoAppearanceScope);

type AppearanceRole = 'contrast' | 'main';

export function isStrictHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

function setCssVariable(style: CSSProperties, variableName: string, value: string) {
  (style as Record<string, string>)[variableName] = value;
}

function getAppearanceRoleVarName(role: AppearanceRole) {
  return role === 'main' ? KITTO_MAIN_COLOR_VAR : KITTO_CONTRAST_COLOR_VAR;
}

function hasRoleValue(appearance: KittoAppearance | KittoTextAppearance | undefined, role: AppearanceRole) {
  const value = role === 'main' ? appearance?.mainColor : appearance?.contrastColor;

  return isStrictHexColor(value);
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
    hasMainColor: parentScope.hasMainColor || isStrictHexColor(appearance?.mainColor),
    hasContrastColor: parentScope.hasContrastColor || isStrictHexColor(appearance?.contrastColor),
  };

  return createElement(KittoAppearanceContext.Provider, { value: scope }, children);
}

export function getAppearanceStyle({
  appearance,
  backgroundRole,
  hasInheritedContrastColor = false,
  hasInheritedMainColor = false,
  textRole,
}: {
  appearance?: KittoAppearance | KittoTextAppearance;
  backgroundRole?: AppearanceRole;
  hasInheritedContrastColor?: boolean;
  hasInheritedMainColor?: boolean;
  textRole?: AppearanceRole;
}): CSSProperties | undefined {
  const style: CSSProperties = {};
  const safeMainColor = isStrictHexColor(appearance?.mainColor) ? appearance.mainColor : undefined;
  const safeContrastColor = isStrictHexColor(appearance?.contrastColor) ? appearance.contrastColor : undefined;

  if (safeMainColor) {
    setCssVariable(style, KITTO_MAIN_COLOR_VAR, safeMainColor);
  }

  if (safeContrastColor) {
    setCssVariable(style, KITTO_CONTRAST_COLOR_VAR, safeContrastColor);
  }

  if (
    textRole &&
    (hasRoleValue(appearance, textRole) || (textRole === 'main' ? hasInheritedMainColor : hasInheritedContrastColor))
  ) {
    style.color = `var(${getAppearanceRoleVarName(textRole)})`;
  }

  if (
    backgroundRole &&
    (hasRoleValue(appearance, backgroundRole) ||
      (backgroundRole === 'main' ? hasInheritedMainColor : hasInheritedContrastColor))
  ) {
    style.backgroundColor = `var(${getAppearanceRoleVarName(backgroundRole)})`;
  }

  return Object.keys(style).length > 0 ? style : undefined;
}
