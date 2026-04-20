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
  it('accepts mainColor and contrastColor appearance overrides', () => {
    expect(appearanceSchema.safeParse({ mainColor: '#111827', contrastColor: '#FFFFFF' }).success).toBe(true);
  });

  it('rejects unknown appearance keys', () => {
    expect(appearanceSchema.safeParse({ color: '#FFFFFF' }).success).toBe(false);
  });

  it('rejects mainColor on Text appearance objects', () => {
    expect(textAppearanceSchema.safeParse({ mainColor: '#111827', contrastColor: '#FFFFFF' }).success).toBe(false);
  });
});
