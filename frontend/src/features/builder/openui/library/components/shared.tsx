import { z } from 'zod';

export const nullableTextSchema = z.union([z.string(), z.null()]).optional();
export const textValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]).optional();

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
