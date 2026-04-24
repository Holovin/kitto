import { describe, expect, it } from 'vitest';
import { createValidationFailureMessage } from '@features/builder/hooks/validationFailureMessage';

describe('createValidationFailureMessage', () => {
  it('summarizes technical validation details for the expandable error details', () => {
    const message = createValidationFailureMessage(
      [
        {
          code: 'excess-args',
          message: 'Group takes 6 arg(s), got 7 (1 excess dropped)',
          source: 'parser',
          statementId: 'root',
        },
      ],
      2,
    );

    expect(message).toContain('The model kept returning draft issues after 2 automatic repair attempts.');
    expect(message).toContain('excess-args in root: Group takes 6 arg(s), got 7 (1 excess dropped)');
  });
});
