import type { CSSProperties } from 'react';
import { z } from 'zod';

export const nullableTextSchema = z.union([z.string(), z.null()]).optional();
export const textValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]).optional();
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const hexColorSchema = z.string().regex(HEX_COLOR_PATTERN).optional();
export const hexColorProp = hexColorSchema.describe('Optional text color override as #RRGGBB.');
export const hexBackgroundProp = hexColorSchema.describe('Optional background color override as #RRGGBB.');
export const hexColorOverrideProps = {
  color: hexColorProp,
  background: hexBackgroundProp,
} as const;

export const choiceOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export function asDisplayText(value: unknown) {
  if (value == null) {
    return '';
  }

  return String(value);
}

export function getHexColorStyle(props: { background?: string; color?: string }): CSSProperties | undefined {
  const style: CSSProperties = {};

  if (props.color) {
    style.color = props.color;
  }

  if (props.background) {
    style.backgroundColor = props.background;
  }

  return Object.keys(style).length > 0 ? style : undefined;
}
