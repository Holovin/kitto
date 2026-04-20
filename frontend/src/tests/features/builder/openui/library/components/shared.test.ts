import { describe, expect, it } from 'vitest';
import {
  appearanceSchema,
  evaluateValidationRules,
  getValidationFeedback,
  hexColorSchema,
  inputTypeSchema,
  sanitizeValidationRules,
  textAppearanceSchema,
  validationRuleSchema,
} from '@features/builder/openui/library/components/shared';

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

describe('inputTypeSchema', () => {
  it('accepts the supported HTML input types', () => {
    expect(inputTypeSchema.safeParse('date').success).toBe(true);
    expect(inputTypeSchema.safeParse('number').success).toBe(true);
    expect(inputTypeSchema.safeParse('email').success).toBe(true);
    expect(inputTypeSchema.safeParse('time').success).toBe(true);
    expect(inputTypeSchema.safeParse('password').success).toBe(true);
  });

  it('rejects unsupported input types', () => {
    expect(inputTypeSchema.safeParse('search').success).toBe(false);
    expect(inputTypeSchema.safeParse('url').success).toBe(false);
    expect(inputTypeSchema.safeParse('tel').success).toBe(false);
  });
});

describe('validationRuleSchema', () => {
  it('accepts structured validation rules', () => {
    expect(validationRuleSchema.safeParse({ type: 'required', message: 'Required' }).success).toBe(true);
    expect(validationRuleSchema.safeParse({ type: 'minNumber', value: 1 }).success).toBe(true);
    expect(validationRuleSchema.safeParse({ type: 'email', message: 'Invalid email' }).success).toBe(true);
  });

  it('rejects removed url validation rules', () => {
    expect(validationRuleSchema.safeParse({ type: 'url' }).success).toBe(false);
  });
});

describe('validation helpers', () => {
  it('fails required validation for empty text', () => {
    const rules = sanitizeValidationRules({ componentType: 'Input', inputType: 'text' }, [{ type: 'required' }]);

    expect(evaluateValidationRules({ target: { componentType: 'Input', inputType: 'text' }, rules, value: '' })).toBe(
      'This field is required.',
    );
  });

  it('requires a required checkbox to be checked', () => {
    const rules = sanitizeValidationRules({ componentType: 'Checkbox' }, [{ type: 'required' }]);

    expect(evaluateValidationRules({ target: { componentType: 'Checkbox' }, rules, value: false })).toBe('This field is required.');
    expect(evaluateValidationRules({ target: { componentType: 'Checkbox' }, rules, value: true })).toBeUndefined();
  });

  it('shows a checkbox error after a submit-like interaction and keeps helper text separate', () => {
    const rules = sanitizeValidationRules(
      { componentType: 'Checkbox' },
      [{ type: 'required', message: 'You must accept the agreement' }],
    );

    expect(
      getValidationFeedback({
        helper: 'Required agreement',
        rules,
        submitLikeInteractionCount: 0,
        target: { componentType: 'Checkbox' },
        touched: false,
        value: false,
      }),
    ).toEqual({
      hasVisibleError: false,
      helperText: 'Required agreement',
      validationError: undefined,
    });

    expect(
      getValidationFeedback({
        helper: 'Required agreement',
        rules,
        submitLikeInteractionCount: 1,
        target: { componentType: 'Checkbox' },
        touched: false,
        value: false,
      }),
    ).toEqual({
      hasVisibleError: true,
      helperText: 'Required agreement',
      validationError: 'You must accept the agreement',
    });
  });

  it('applies minLength and maxLength for text inputs', () => {
    const rules = sanitizeValidationRules(
      { componentType: 'Input', inputType: 'text' },
      [
        { type: 'minLength', value: 3 },
        { type: 'maxLength', value: 5 },
      ],
    );

    expect(evaluateValidationRules({ target: { componentType: 'Input', inputType: 'text' }, rules, value: 'ab' })).toBe(
      'Must be at least 3 characters.',
    );
    expect(evaluateValidationRules({ target: { componentType: 'Input', inputType: 'text' }, rules, value: 'abcdef' })).toBe(
      'Must be no more than 5 characters.',
    );
  });

  it('applies minNumber and maxNumber only for number inputs', () => {
    const numberRules = sanitizeValidationRules(
      { componentType: 'Input', inputType: 'number' },
      [
        { type: 'minNumber', value: 1 },
        { type: 'maxNumber', value: 10 },
      ],
    );
    const textRules = sanitizeValidationRules({ componentType: 'Input', inputType: 'text' }, [{ type: 'minNumber', value: 1 }]);

    expect(evaluateValidationRules({ target: { componentType: 'Input', inputType: 'number' }, rules: numberRules, value: '0' })).toBe(
      'Must be at least 1.',
    );
    expect(evaluateValidationRules({ target: { componentType: 'Input', inputType: 'number' }, rules: numberRules, value: '11' })).toBe(
      'Must be no more than 10.',
    );
    expect(textRules).toEqual([]);
  });

  it('applies date rules only for date inputs', () => {
    const dateRules = sanitizeValidationRules(
      { componentType: 'Input', inputType: 'date' },
      [
        { type: 'dateOnOrAfter', value: '2026-04-20' },
        { type: 'dateOnOrBefore', value: '2026-04-30' },
      ],
    );
    const timeRules = sanitizeValidationRules(
      { componentType: 'Input', inputType: 'time' },
      [{ type: 'dateOnOrAfter', value: '2026-04-20' }],
    );

    expect(evaluateValidationRules({ target: { componentType: 'Input', inputType: 'date' }, rules: dateRules, value: '2026-04-19' })).toBe(
      'Date must be on or after 2026-04-20.',
    );
    expect(evaluateValidationRules({ target: { componentType: 'Input', inputType: 'date' }, rules: dateRules, value: '2026-05-01' })).toBe(
      'Date must be on or before 2026-04-30.',
    );
    expect(timeRules).toEqual([]);
  });

  it('applies email validation only on email inputs', () => {
    const emailRules = sanitizeValidationRules({ componentType: 'Input', inputType: 'email' }, [{ type: 'email' }]);
    const textRules = sanitizeValidationRules({ componentType: 'Input', inputType: 'text' }, [{ type: 'email' }]);

    expect(evaluateValidationRules({ target: { componentType: 'Input', inputType: 'email' }, rules: emailRules, value: 'bad-email' })).toBe(
      'Enter a valid email address.',
    );
    expect(textRules).toEqual([]);
  });
});
