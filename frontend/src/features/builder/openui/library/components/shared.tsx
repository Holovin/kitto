import { createContext, useCallback, useContext, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { z } from 'zod';

export const nullableTextSchema = z.union([z.string(), z.null()]).optional();
export const textValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]).optional();
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const hexColorSchema = z.string().regex(HEX_COLOR_PATTERN).optional();
const appearanceMainColorProp = hexColorSchema.describe('Optional main theme color override as #RRGGBB.');
const appearanceContrastColorProp = hexColorSchema.describe('Optional contrast theme color override as #RRGGBB.');

export const KITTO_MAIN_COLOR_VAR = '--kitto-main-color';
export const KITTO_CONTRAST_COLOR_VAR = '--kitto-contrast-color';
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

export type KittoAppearance = {
  contrastColor?: string;
  mainColor?: string;
};

export type KittoTextAppearance = {
  contrastColor?: string;
  mainColor?: never;
};

export type InputType = (typeof INPUT_TYPES)[number];
export type ValidationRuleType = (typeof VALIDATION_RULE_TYPES)[number];
export type ValidationComponentType = 'Checkbox' | 'Input' | 'RadioGroup' | 'Select' | 'TextArea';
export type ValidationTarget =
  | { componentType: 'Checkbox' }
  | { componentType: 'Input'; inputType: InputType }
  | { componentType: 'RadioGroup' }
  | { componentType: 'Select' }
  | { componentType: 'TextArea' };

export type ValidationRule =
  | { type: 'required'; message?: string }
  | { type: 'minLength'; message?: string; value: number }
  | { type: 'maxLength'; message?: string; value: number }
  | { type: 'minNumber'; message?: string; value: number }
  | { type: 'maxNumber'; message?: string; value: number }
  | { type: 'dateOnOrAfter'; message?: string; value: string }
  | { type: 'dateOnOrBefore'; message?: string; value: string }
  | { type: 'email'; message?: string };

export interface ValidationConfigIssue {
  message: string;
  path: string;
}

const inputTypeSchemaValues = z.enum(INPUT_TYPES);
const validationRuleTypeSchema = z.enum(VALIDATION_RULE_TYPES);

export const inputTypeSchema = inputTypeSchemaValues
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

const validationRuleTypesByInputType: Record<InputType, ValidationRuleType[]> = {
  text: ['required', 'minLength', 'maxLength'],
  email: ['required', 'minLength', 'maxLength', 'email'],
  number: ['required', 'minNumber', 'maxNumber'],
  date: ['required', 'dateOnOrAfter', 'dateOnOrBefore'],
  time: ['required'],
  password: ['required', 'minLength', 'maxLength'],
};

const validationRuleTypesByComponent: Record<Exclude<ValidationComponentType, 'Input'>, ValidationRuleType[]> = {
  TextArea: ['required', 'minLength', 'maxLength'],
  Select: ['required'],
  RadioGroup: ['required'],
  Checkbox: ['required'],
};

type KittoAppearanceScope = {
  hasContrastColor: boolean;
  hasMainColor: boolean;
};

type KittoValidationInteractionContextValue = {
  markSubmitLikeInteraction: () => void;
  submitLikeInteractionCount: number;
};

const defaultKittoAppearanceScope: KittoAppearanceScope = {
  hasContrastColor: false,
  hasMainColor: false,
};

const defaultKittoValidationInteractionContext: KittoValidationInteractionContextValue = {
  markSubmitLikeInteraction: () => undefined,
  submitLikeInteractionCount: 0,
};

const KittoAppearanceContext = createContext<KittoAppearanceScope>(defaultKittoAppearanceScope);
const KittoValidationInteractionContext = createContext<KittoValidationInteractionContextValue>(
  defaultKittoValidationInteractionContext,
);

export function asDisplayText(value: unknown) {
  if (value == null) {
    return '';
  }

  return String(value);
}

export function isStrictHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

function isAstNode(value: unknown): value is { k: string } {
  return typeof value === 'object' && value !== null && 'k' in value && typeof value.k === 'string';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || isAstNode(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function isValidationRuleType(value: unknown): value is ValidationRuleType {
  return typeof value === 'string' && VALIDATION_RULE_TYPES.some((ruleType) => ruleType === value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function getDaysInMonth(year: number, month: number) {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

export function isStrictIsoDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  if (month < 1 || month > 12) {
    return false;
  }

  return day >= 1 && day <= getDaysInMonth(year, month);
}

function getAllowedValidationRuleTypes(target: ValidationTarget) {
  if (target.componentType === 'Input') {
    return new Set(validationRuleTypesByInputType[target.inputType]);
  }

  return new Set(validationRuleTypesByComponent[target.componentType]);
}

function describeValidationTarget(target: ValidationTarget) {
  if (target.componentType === 'Input') {
    return `Input type "${target.inputType}"`;
  }

  return target.componentType;
}

function createValidationRulePath(index: number, fieldName: string) {
  return `validation[${index}].${fieldName}`;
}

function sanitizeValidationMessage(message: unknown) {
  return typeof message === 'string' && message.trim().length > 0 ? message : undefined;
}

function pushValidationIssue(issues: ValidationConfigIssue[], index: number, fieldName: string, message: string) {
  issues.push({
    path: createValidationRulePath(index, fieldName),
    message,
  });
}

function validateValidationRuleConfig(target: ValidationTarget, rule: Record<string, unknown>, index: number) {
  const issues: ValidationConfigIssue[] = [];
  const rawType = rule.type;

  if (isAstNode(rawType) || typeof rawType !== 'string') {
    pushValidationIssue(issues, index, 'type', `${createValidationRulePath(index, 'type')} must be a string literal.`);
    return issues;
  }

  if (!isValidationRuleType(rawType)) {
    pushValidationIssue(
      issues,
      index,
      'type',
      `${createValidationRulePath(index, 'type')} must be one of ${VALIDATION_RULE_TYPES.map((ruleType) => `"${ruleType}"`).join(', ')}.`,
    );
    return issues;
  }

  if (!getAllowedValidationRuleTypes(target).has(rawType)) {
    pushValidationIssue(
      issues,
      index,
      'type',
      `${describeValidationTarget(target)} does not support validation rule "${rawType}".`,
    );
  }

  if ('message' in rule && rule.message !== undefined && (isAstNode(rule.message) || typeof rule.message !== 'string')) {
    pushValidationIssue(issues, index, 'message', `${createValidationRulePath(index, 'message')} must be a string literal.`);
  }

  if (rawType === 'required' || rawType === 'email') {
    if (rule.value !== undefined) {
      pushValidationIssue(issues, index, 'value', `Validation rule "${rawType}" does not accept a value.`);
    }

    return issues;
  }

  if (isAstNode(rule.value)) {
    pushValidationIssue(issues, index, 'value', `${createValidationRulePath(index, 'value')} must be a literal value.`);
    return issues;
  }

  switch (rawType) {
    case 'minLength':
    case 'maxLength':
      if (!isNonNegativeInteger(rule.value)) {
        pushValidationIssue(issues, index, 'value', `Validation rule "${rawType}" requires a non-negative integer value.`);
      }
      return issues;
    case 'minNumber':
    case 'maxNumber':
      if (!isFiniteNumber(rule.value)) {
        pushValidationIssue(issues, index, 'value', `Validation rule "${rawType}" requires a finite numeric value.`);
      }
      return issues;
    case 'dateOnOrAfter':
    case 'dateOnOrBefore':
      if (typeof rule.value !== 'string') {
        pushValidationIssue(issues, index, 'value', `Validation rule "${rawType}" requires a YYYY-MM-DD date string.`);
        return issues;
      }

      if (!isStrictIsoDateString(rule.value)) {
        pushValidationIssue(issues, index, 'value', `Validation rule "${rawType}" requires a valid YYYY-MM-DD calendar date.`);
      }
      return issues;
  }
}

export function inspectValidationConfig(args: {
  componentType: ValidationComponentType;
  inputType?: unknown;
  validation: unknown;
}): ValidationConfigIssue[] {
  const { componentType, inputType, validation } = args;

  if (validation === undefined) {
    return [];
  }

  if (isAstNode(validation) || !Array.isArray(validation)) {
    return [
      {
        path: 'validation',
        message: `${componentType}.validation must be a literal array of validation rule objects.`,
      },
    ];
  }

  if (componentType === 'Input' && inputType !== undefined && (isAstNode(inputType) || typeof inputType !== 'string')) {
    return [
      {
        path: 'type',
        message: 'Input.type must be a string literal.',
      },
    ];
  }

  if (componentType === 'Input' && inputType !== undefined && !inputTypeSchemaValues.safeParse(inputType).success) {
    return [];
  }

  const target: ValidationTarget =
    componentType === 'Input'
      ? {
          componentType: 'Input',
          inputType: inputType === undefined ? 'text' : (inputType as InputType),
        }
      : { componentType };

  const issues: ValidationConfigIssue[] = [];

  validation.forEach((rule, index) => {
    if (!isPlainObject(rule)) {
      issues.push({
        path: `validation[${index}]`,
        message: `${componentType}.validation[${index}] must be a plain validation rule object.`,
      });
      return;
    }

    issues.push(...validateValidationRuleConfig(target, rule, index));
  });

  return issues;
}

export function sanitizeValidationRules(target: ValidationTarget, rawRules: unknown): ValidationRule[] {
  if (!Array.isArray(rawRules)) {
    return [];
  }

  const allowedRuleTypes = getAllowedValidationRuleTypes(target);
  const rules: ValidationRule[] = [];

  for (const rawRule of rawRules) {
    if (!isPlainObject(rawRule) || !isValidationRuleType(rawRule.type) || !allowedRuleTypes.has(rawRule.type)) {
      continue;
    }

    const message = sanitizeValidationMessage(rawRule.message);

    switch (rawRule.type) {
      case 'required':
      case 'email':
        rules.push(message ? { type: rawRule.type, message } : { type: rawRule.type });
        break;
      case 'minLength':
      case 'maxLength':
        if (isNonNegativeInteger(rawRule.value)) {
          rules.push(message ? { type: rawRule.type, value: rawRule.value, message } : { type: rawRule.type, value: rawRule.value });
        }
        break;
      case 'minNumber':
      case 'maxNumber':
        if (isFiniteNumber(rawRule.value)) {
          rules.push(message ? { type: rawRule.type, value: rawRule.value, message } : { type: rawRule.type, value: rawRule.value });
        }
        break;
      case 'dateOnOrAfter':
      case 'dateOnOrBefore':
        if (typeof rawRule.value === 'string' && isStrictIsoDateString(rawRule.value)) {
          rules.push(message ? { type: rawRule.type, value: rawRule.value, message } : { type: rawRule.type, value: rawRule.value });
        }
        break;
    }
  }

  return rules;
}

function parseNumberInput(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  const parsedValue = Number(trimmedValue);

  return Number.isFinite(parsedValue) ? parsedValue : Number.NaN;
}

function isEmptyValidationValue(value: unknown) {
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }

  return value == null;
}

export function evaluateValidationRules(args: {
  target: ValidationTarget;
  rules: ValidationRule[];
  value: unknown;
}) {
  const { rules, target, value } = args;

  for (const rule of rules) {
    switch (rule.type) {
      case 'required':
        if (target.componentType === 'Checkbox') {
          if (value !== true) {
            return rule.message ?? 'This field is required.';
          }
          break;
        }

        if (isEmptyValidationValue(value)) {
          return rule.message ?? 'This field is required.';
        }
        break;
      case 'minLength':
        if (typeof value === 'string' && value.length < rule.value) {
          return rule.message ?? `Must be at least ${rule.value} characters.`;
        }
        break;
      case 'maxLength':
        if (typeof value === 'string' && value.length > rule.value) {
          return rule.message ?? `Must be no more than ${rule.value} characters.`;
        }
        break;
      case 'minNumber': {
        const parsedValue = parseNumberInput(value);

        if (parsedValue === null) {
          break;
        }

        if (Number.isNaN(parsedValue)) {
          return 'Enter a valid number.';
        }

        if (parsedValue < rule.value) {
          return rule.message ?? `Must be at least ${rule.value}.`;
        }
        break;
      }
      case 'maxNumber': {
        const parsedValue = parseNumberInput(value);

        if (parsedValue === null) {
          break;
        }

        if (Number.isNaN(parsedValue)) {
          return 'Enter a valid number.';
        }

        if (parsedValue > rule.value) {
          return rule.message ?? `Must be no more than ${rule.value}.`;
        }
        break;
      }
      case 'dateOnOrAfter':
        if (typeof value !== 'string' || value.length === 0) {
          break;
        }

        if (!isStrictIsoDateString(value)) {
          return 'Enter a valid date.';
        }

        if (value < rule.value) {
          return rule.message ?? `Date must be on or after ${rule.value}.`;
        }
        break;
      case 'dateOnOrBefore':
        if (typeof value !== 'string' || value.length === 0) {
          break;
        }

        if (!isStrictIsoDateString(value)) {
          return 'Enter a valid date.';
        }

        if (value > rule.value) {
          return rule.message ?? `Date must be on or before ${rule.value}.`;
        }
        break;
      case 'email':
        if (typeof value === 'string' && value.length > 0) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            return rule.message ?? 'Enter a valid email address.';
          }
        }
        break;
    }
  }

  return undefined;
}

function getNormalizedHelperText(helper: string | null | undefined) {
  return typeof helper === 'string' && helper.trim().length > 0 ? helper : undefined;
}

export function getValidationFeedback(args: {
  helper?: string | null;
  rules: ValidationRule[];
  submitLikeInteractionCount: number;
  target: ValidationTarget;
  touched: boolean;
  value: unknown;
}) {
  const { helper, rules, submitLikeInteractionCount, target, touched, value } = args;
  const validationError =
    touched || submitLikeInteractionCount > 0
      ? evaluateValidationRules({
          rules,
          target,
          value,
        })
      : undefined;

  return {
    hasVisibleError: validationError !== undefined,
    helperText: validationError ?? getNormalizedHelperText(helper),
    validationError,
  };
}

export function getInputAutoComplete(name: string, inputType: InputType) {
  if (name === 'name') {
    return 'name';
  }

  switch (inputType) {
    case 'email':
      return 'email';
    case 'password':
      return 'current-password';
    default:
      return undefined;
  }
}

function setCssVariable(style: CSSProperties, variableName: string, value: string) {
  (style as Record<string, string>)[variableName] = value;
}

export function useKittoAppearanceScope() {
  return useContext(KittoAppearanceContext);
}

export function useKittoValidationInteraction() {
  return useContext(KittoValidationInteractionContext);
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

  return <KittoAppearanceContext.Provider value={scope}>{children}</KittoAppearanceContext.Provider>;
}

export function KittoValidationInteractionProvider({ children }: { children: ReactNode }) {
  const [submitLikeInteractionCount, setSubmitLikeInteractionCount] = useState(0);
  const markSubmitLikeInteraction = useCallback(() => {
    setSubmitLikeInteractionCount((count) => count + 1);
  }, []);
  const value = useMemo(
    () => ({
      markSubmitLikeInteraction,
      submitLikeInteractionCount,
    }),
    [markSubmitLikeInteraction, submitLikeInteractionCount],
  );

  return <KittoValidationInteractionContext.Provider value={value}>{children}</KittoValidationInteractionContext.Provider>;
}

type AppearanceRole = 'contrast' | 'main';

function getAppearanceRoleVarName(role: AppearanceRole) {
  return role === 'main' ? KITTO_MAIN_COLOR_VAR : KITTO_CONTRAST_COLOR_VAR;
}

function hasRoleValue(appearance: KittoAppearance | KittoTextAppearance | undefined, role: AppearanceRole) {
  const value = role === 'main' ? appearance?.mainColor : appearance?.contrastColor;

  return isStrictHexColor(value);
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
