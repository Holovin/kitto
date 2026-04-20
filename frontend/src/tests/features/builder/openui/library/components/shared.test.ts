import { describe, expect, it } from 'vitest';
import { hexColorSchema } from '@features/builder/openui/library/components/shared';

describe('hexColorSchema', () => {
  it.each(['#000000', '#FFFFFF'])('accepts strict six-character hex colors like %s', (value) => {
    expect(hexColorSchema.safeParse(value).success).toBe(true);
  });

  it.each(['#fff', 'red', 'rgb(0,0,0)', 'var(--x)', 'url(...)'])('rejects unsafe color value %s', (value) => {
    expect(hexColorSchema.safeParse(value).success).toBe(false);
  });
});
