import { z } from 'zod';

export const nullableTextSchema = z.union([z.string(), z.null()]).optional();
export const textValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]).optional();
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const hexColorSchema = z.string().regex(HEX_COLOR_PATTERN).optional();
const appearanceMainColorProp = hexColorSchema.describe('Optional main theme color override as #RRGGBB.');
const appearanceContrastColorProp = hexColorSchema.describe('Optional contrast theme color override as #RRGGBB.');

export const INPUT_TYPES = ['text', 'email', 'number', 'date', 'time', 'password'] as const;
export const VALIDATION_RULE_TYPES = [
  'required',
  'minLength',
  'maxLength',
  'minNumber',
  'maxNumber',
  'dateOnOrAfter',
  'dateOnOrBefore',
  'email',
] as const;

export type InputType = (typeof INPUT_TYPES)[number];
export type ValidationRuleType = (typeof VALIDATION_RULE_TYPES)[number];

const inputTypeEnum = z.enum(INPUT_TYPES);
const validationRuleTypeSchema = z.enum(VALIDATION_RULE_TYPES);

export const inputTypeSchema = inputTypeEnum
  .default('text')
  .describe('HTML input type. Allowed values: text, email, number, date, time, password. Defaults to text.');

export const validationRuleSchema = z
  .object({
    type: validationRuleTypeSchema.describe('Validation rule name.'),
    value: z.union([z.number(), z.string()]).optional().describe('Rule value for length, number, or date comparisons.'),
    message: z.string().optional().describe('Optional custom validation message shown when the rule fails.'),
  })
  .strict();

export const validationRulesSchema = z
  .array(validationRuleSchema)
  .optional()
  .describe('Optional declarative validation rules. Use only rules supported by the component and input type.');

export type ValidationRuleConfig = z.infer<typeof validationRuleSchema>;
export type ValidationRuleConfigList = z.infer<typeof validationRulesSchema>;

export const appearanceSchema = z
  .object({
    mainColor: appearanceMainColorProp,
    contrastColor: appearanceContrastColorProp,
  })
  .strict()
  .optional()
  .describe('Optional appearance override with mainColor and contrastColor as #RRGGBB.');

export const textAppearanceSchema = z
  .object({
    contrastColor: appearanceContrastColorProp,
  })
  .strict()
  .optional()
  .describe('Optional appearance override with contrastColor as #RRGGBB.');

export const choiceOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export type ChoiceOption = z.infer<typeof choiceOptionSchema>;

export function normalizeChoiceOptions(options: unknown): ChoiceOption[] {
  if (!Array.isArray(options)) {
    return [];
  }

  return options.flatMap((option) => {
    if (typeof option === 'string') {
      return [{ label: option, value: option }];
    }

    const parsed = choiceOptionSchema.safeParse(option);

    return parsed.success ? [parsed.data] : [];
  });
}

export function asDisplayText(value: unknown) {
  if (value == null) {
    return '';
  }

  return String(value);
}
