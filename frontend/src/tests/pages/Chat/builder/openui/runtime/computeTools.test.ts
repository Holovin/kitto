import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeValue } from '@pages/Chat/builder/openui/runtime/computeTools';

describe('computeValue', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles truthy, falsy, and not boolean operations', () => {
    expect(computeValue({ op: 'truthy', input: 'kitto' })).toEqual({ value: true });
    expect(computeValue({ op: 'falsy', input: '' })).toEqual({ value: true });
    expect(computeValue({ op: 'not', input: 1 })).toEqual({ value: false });
  });

  it('handles and/or boolean operations over values arrays', () => {
    expect(computeValue({ op: 'and', values: [true, 1, 'ok'] })).toEqual({ value: true });
    expect(computeValue({ op: 'or', values: [0, '', false, 'ready'] })).toEqual({ value: true });
  });

  it('normalizes primitive equality and inequality comparisons', () => {
    expect(computeValue({ op: 'equals', left: true, right: 'true' })).toEqual({ value: true });
    expect(computeValue({ op: 'equals', left: 42, right: '42' })).toEqual({ value: true });
    expect(computeValue({ op: 'equals', left: 42, right: ' 42 ' })).toEqual({ value: true });
    expect(computeValue({ op: 'equals', left: undefined, right: null })).toEqual({ value: true });
    expect(computeValue({ op: 'equals', left: 'abc', right: 'abc' })).toEqual({ value: true });
    expect(computeValue({ op: 'not_equals', left: 'Ada', right: 'Grace' })).toEqual({ value: true });
  });

  it.each([
    ['equals rejects object operands', { op: 'equals', left: {}, right: {} } as const, 'left'],
    ['equals rejects array operands', { op: 'equals', left: [], right: [] } as const, 'left'],
    ['equals rejects object compared with primitive', { op: 'equals', left: {}, right: 'x' } as const, 'left'],
    ['equals rejects array compared with primitive', { op: 'equals', left: ['x'], right: 'x' } as const, 'left'],
    ['not_equals rejects object operands', { op: 'not_equals', left: {}, right: {} } as const, 'left'],
    ['equals rejects function operands', { op: 'equals', left: () => 'x', right: 'x' } as const, 'left'],
    ['equals reports right object operands', { op: 'equals', left: 'x', right: {} } as const, 'right'],
  ])('%s', (_name, input, label) => {
    expect(() => computeValue(input)).toThrow(
      `compute_value ${label} for equals/not_equals must be a primitive string, number, boolean, null, or undefined.`,
    );
  });

  it('handles numeric comparison operations', () => {
    expect(computeValue({ op: 'number_gt', left: '5', right: 4 })).toEqual({ value: true });
    expect(computeValue({ op: 'number_gte', left: '5', right: 5 })).toEqual({ value: true });
    expect(computeValue({ op: 'number_lt', left: 3, right: '4' })).toEqual({ value: true });
    expect(computeValue({ op: 'number_lte', left: 3, right: '3' })).toEqual({ value: true });
  });

  it('rejects invalid numeric comparisons', () => {
    expect(() => computeValue({ op: 'number_gt', left: 'nope', right: 2 })).toThrow('left must be a finite number or numeric string.');
  });

  it('handles empty and non-empty string checks', () => {
    expect(computeValue({ op: 'is_empty', input: null })).toEqual({ value: true });
    expect(computeValue({ op: 'not_empty', input: 'Ada' })).toEqual({ value: true });
  });

  it('handles contains, starts_with, and ends_with string checks', () => {
    expect(computeValue({ op: 'contains_text', input: 'Ada Lovelace', options: { query: 'Love' } })).toEqual({ value: true });
    expect(computeValue({ op: 'starts_with', input: 'Kitto', options: { query: 'Kit' } })).toEqual({ value: true });
    expect(computeValue({ op: 'ends_with', input: 'Kitto', options: { query: 'tto' } })).toEqual({ value: true });
  });

  it('handles trim and case transformations', () => {
    expect(computeValue({ op: 'trim', input: '  Ada  ' })).toEqual({ value: 'Ada' });
    expect(computeValue({ op: 'to_lower', input: 'Ada' })).toEqual({ value: 'ada' });
    expect(computeValue({ op: 'to_upper', input: 'Ada' })).toEqual({ value: 'ADA' });
  });

  it('handles numeric conversions and arithmetic', () => {
    expect(computeValue({ op: 'to_number', input: '42' })).toEqual({ value: 42 });
    expect(computeValue({ op: 'add', left: '4', right: 3 })).toEqual({ value: 7 });
    expect(computeValue({ op: 'subtract', left: 10, right: '3' })).toEqual({ value: 7 });
    expect(computeValue({ op: 'multiply', left: 4, right: '3' })).toEqual({ value: 12 });
  });

  it('rejects division by zero', () => {
    expect(() => computeValue({ op: 'divide', left: 10, right: 0 })).toThrow('Cannot divide by zero.');
  });

  it('handles clamp', () => {
    expect(computeValue({ op: 'clamp', input: 12, options: { min: 1, max: 10 } })).toEqual({ value: 10 });
  });

  it('returns integer random_int results within the requested range', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const result = computeValue({ op: 'random_int', options: { min: 1, max: 6 } });

    expect(Number.isInteger(result.value)).toBe(true);
    expect(result.value).toBeGreaterThanOrEqual(1);
    expect(result.value).toBeLessThanOrEqual(6);
  });

  it('rejects random_int ranges where min is greater than max', () => {
    expect(() => computeValue({ op: 'random_int', options: { min: 6, max: 1 } })).toThrow(
      'options.min must be less than or equal to options.max.',
    );
  });

  it('clamps unsafe random_int ranges into the safe allowed bounds', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    expect(computeValue({ op: 'random_int', options: { min: -9_999_999, max: 9_999_999 } })).toEqual({
      value: -1_000_000,
    });
  });

  it('returns today_date in YYYY-MM-DD format', () => {
    expect(computeValue({ op: 'today_date' })).toEqual({
      value: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it('handles ISO date comparisons', () => {
    expect(computeValue({ op: 'date_before', left: '2026-04-19', right: '2026-04-20' })).toEqual({ value: true });
    expect(computeValue({ op: 'date_after', left: '2026-04-21', right: '2026-04-20' })).toEqual({ value: true });
    expect(computeValue({ op: 'date_on_or_before', left: '2026-04-20', right: '2026-04-20' })).toEqual({ value: true });
    expect(computeValue({ op: 'date_on_or_after', left: '2026-04-20', right: '2026-04-20' })).toEqual({ value: true });
  });

  it('rejects invalid or natural-language dates', () => {
    expect(() => computeValue({ op: 'date_before', left: '2026-02-30', right: '2026-03-01' })).toThrow(
      'left must be a valid calendar date.',
    );
    expect(() => computeValue({ op: 'date_before', left: 'tomorrow', right: '2026-03-01' })).toThrow(
      'left must be a YYYY-MM-DD date string.',
    );
  });

  it('rejects unknown operations', () => {
    expect(() => computeValue({ op: 'run_js' as never })).toThrow('Unknown compute op "run_js".');
  });

  it('treats function-like strings as plain text', () => {
    expect(
      computeValue({
        op: 'contains_text',
        input: 'Function("return 7")()',
        options: { query: 'return 7' },
      }),
    ).toEqual({ value: true });
  });

  it('rejects regex options and always returns a primitive result', () => {
    expect(() => computeValue({ op: 'contains_text', input: 'abc', options: { query: 'a', regex: '.*' } })).toThrow(
      'Regular expressions are not supported.',
    );

    const result = computeValue({ op: 'truthy', input: { safe: true } });

    expect(result).toEqual({ value: true });
    expect(typeof result.value).toBe('boolean');
  });
});
