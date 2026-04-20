import { describe, expect, it } from 'vitest';
import { createValidationFailureMessage } from '@features/builder/hooks/validationFailureMessage';

describe('createValidationFailureMessage', () => {
  it('appends the retry guidance that explains no new version was created', () => {
    const message = createValidationFailureMessage(
      [
        {
          code: 'excess-args',
          message: 'Group takes 6 arg(s), got 7 (1 excess dropped)',
          source: 'parser',
          statementId: 'root',
        },
      ],
      1,
    );

    expect(message).toContain('The model kept returning invalid OpenUI after 1 automatic repair attempt.');
    expect(message).toContain('excess-args in root: Group takes 6 arg(s), got 7 (1 excess dropped)');
    expect(message).toContain('An error occurred, a new version was not created. Please try rephrasing your request and run it again.');
  });
});
