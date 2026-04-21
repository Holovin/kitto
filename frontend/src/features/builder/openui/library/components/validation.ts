import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { INPUT_TYPES, VALIDATION_RULE_TYPES, type InputType, type ValidationRuleType } from './schemas';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

type KittoValidationInteractionContextValue = {
  getRegisteredFieldNames: () => string[];
  interactedNames: ReadonlySet<string>;
  markSubmitLikeInteraction: (names: string[]) => void;
  registerFieldName: (name: string) => () => void;
};

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

const emptyInteractedNames = new Set<string>();

const defaultKittoValidationInteractionContext: KittoValidationInteractionContextValue = {
  getRegisteredFieldNames: () => [],
  interactedNames: emptyInteractedNames,
  markSubmitLikeInteraction: () => undefined,
  registerFieldName: () => () => undefined,
};

const KittoValidationInteractionContext = createContext<KittoValidationInteractionContextValue>(
  defaultKittoValidationInteractionContext,
);

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

function getNormalizedHelperText(helper: string | null | undefined) {
  return typeof helper === 'string' && helper.trim().length > 0 ? helper : undefined;
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

  if (componentType === 'Input' && inputType !== undefined && !INPUT_TYPES.some((allowedInputType) => allowedInputType === inputType)) {
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

export function getValidationFeedback(args: {
  helper?: string | null;
  interactedNames: ReadonlySet<string>;
  name: string;
  rules: ValidationRule[];
  target: ValidationTarget;
  touched: boolean;
  value: unknown;
}) {
  const { helper, interactedNames, name, rules, target, touched, value } = args;
  const validationError =
    touched || interactedNames.has(name)
      ? evaluateValidationRules({
          rules,
          target,
          value,
        })
      : undefined;

  return {
    hasVisibleError: validationError !== undefined,
    helperText: getNormalizedHelperText(helper),
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
      return 'off';
  }
}

export function useKittoValidationInteraction() {
  return useContext(KittoValidationInteractionContext);
}

export function useRegisterKittoValidationField(name: string) {
  const { registerFieldName } = useKittoValidationInteraction();

  useEffect(() => registerFieldName(name), [name, registerFieldName]);
}

export function KittoValidationInteractionProvider({ children }: { children: ReactNode }) {
  const [interactedNames, setInteractedNames] = useState<ReadonlySet<string>>(emptyInteractedNames);
  const registeredFieldCountsRef = useRef(new Map<string, number>());
  const markSubmitLikeInteraction = useCallback((names: string[]) => {
    if (names.length === 0) {
      return;
    }

    setInteractedNames((currentNames) => {
      let nextNames: Set<string> | null = null;

      for (const name of names) {
        if (name.length === 0 || currentNames.has(name)) {
          continue;
        }

        nextNames ??= new Set(currentNames);
        nextNames.add(name);
      }

      return nextNames ?? currentNames;
    });
  }, []);
  const registerFieldName = useCallback((name: string) => {
    if (name.length === 0) {
      return () => undefined;
    }

    const registeredFieldCounts = registeredFieldCountsRef.current;
    registeredFieldCounts.set(name, (registeredFieldCounts.get(name) ?? 0) + 1);

    return () => {
      const currentCount = registeredFieldCounts.get(name);
      if (currentCount == null) {
        return;
      }

      if (currentCount <= 1) {
        registeredFieldCounts.delete(name);
        return;
      }

      registeredFieldCounts.set(name, currentCount - 1);
    };
  }, []);
  const getRegisteredFieldNames = useCallback(() => {
    return Array.from(registeredFieldCountsRef.current.keys());
  }, []);
  const value = useMemo(
    () => ({
      getRegisteredFieldNames,
      interactedNames,
      markSubmitLikeInteraction,
      registerFieldName,
    }),
    [getRegisteredFieldNames, interactedNames, markSubmitLikeInteraction, registerFieldName],
  );

  return createElement(KittoValidationInteractionContext.Provider, { value }, children);
}
