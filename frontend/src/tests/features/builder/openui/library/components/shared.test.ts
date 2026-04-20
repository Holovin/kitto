import { describe, expect, it } from 'vitest';
import { appearanceSchema, hexColorSchema, textAppearanceSchema } from '@features/builder/openui/library/components/shared';

describe('hexColorSchema', () => {
  it.each(['#000000', '#FFFFFF'])('accepts strict six-character hex colors like %s', (value) => {
    expect(hexColorSchema.safeParse(value).success).toBe(true);
  });

  it.each(['#fff', 'red', 'rgb(0,0,0)', 'var(--x)', 'url(...)'])('rejects unsafe color value %s', (value) => {
    expect(hexColorSchema.safeParse(value).success).toBe(false);
  });
});

describe('appearanceSchema', () => {
  it('accepts textColor and bgColor appearance overrides', () => {
    expect(appearanceSchema.safeParse({ textColor: '#FFFFFF', bgColor: '#111827' }).success).toBe(true);
  });

  it('rejects unknown appearance keys', () => {
    expect(appearanceSchema.safeParse({ color: '#FFFFFF' }).success).toBe(false);
  });

  it('rejects bgColor on Text appearance objects', () => {
    expect(textAppearanceSchema.safeParse({ textColor: '#FFFFFF', bgColor: '#111827' }).success).toBe(false);
  });
});
