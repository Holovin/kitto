import { describe, expect, it } from 'vitest';
import { createPartialOpenUiEnvelopeParser } from '@pages/Chat/builder/api/partialOpenUiEnvelope';

describe('partialOpenUiEnvelope', () => {
  it('incrementally extracts top-level summary and source string values', () => {
    const parser = createPartialOpenUiEnvelopeParser();

    expect(parser.append('{"summ')).toEqual({});
    expect(parser.append('ary":"Builds')).toEqual({
      summary: {
        complete: false,
        value: 'Builds',
      },
    });
    expect(parser.append(' a","source":"root = App')).toEqual({
      source: {
        complete: false,
        value: 'root = App',
      },
      summary: {
        complete: true,
        value: 'Builds a',
      },
    });
    expect(parser.append('Shell([])"}')).toEqual({
      source: {
        complete: true,
        value: 'root = AppShell([])',
      },
      summary: {
        complete: true,
        value: 'Builds a',
      },
    });
  });

  it('keeps escape state across appended chunks', () => {
    const parser = createPartialOpenUiEnvelopeParser();

    expect(parser.append('{"summary":"Line\\')).toEqual({
      summary: {
        complete: false,
        value: 'Line',
      },
    });
    expect(parser.append('nOne","source":"Letter: \\u')).toEqual({
      source: {
        complete: false,
        value: 'Letter: ',
      },
      summary: {
        complete: true,
        value: 'Line\nOne',
      },
    });
    expect(parser.append('0041"}')).toEqual({
      source: {
        complete: true,
        value: 'Letter: A',
      },
      summary: {
        complete: true,
        value: 'Line\nOne',
      },
    });
  });

  it('ignores nested source fields', () => {
    const parser = createPartialOpenUiEnvelopeParser();

    expect(parser.append('{"metadata":{"source":"nested"},"source":"top"}')).toEqual({
      source: {
        complete: true,
        value: 'top',
      },
    });
  });
});
