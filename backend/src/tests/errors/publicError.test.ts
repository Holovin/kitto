import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { REQUEST_BODY_TOO_LARGE_PUBLIC_MESSAGE, toPublicErrorPayload } from '../../errors/publicError.js';

function getZodError(result: { success: boolean; error?: z.ZodError }) {
  if (!result.success) {
    return result.error as z.ZodError;
  }

  throw new Error('Expected schema validation to fail.');
}

describe('toPublicErrorPayload', () => {
  it('returns the prompt-specific too_big message', () => {
    const error = getZodError(
      z
        .object({
          prompt: z.string().max(8, 'Prompt is too large. Limit: 8 characters.'),
        })
        .safeParse({
          prompt: 'x'.repeat(9),
        }),
    );

    expect(toPublicErrorPayload(error)).toEqual({
      code: 'validation_error',
      error: 'Prompt is too large. Limit: 8 characters.',
      status: 400,
    });
  });

  it('returns the validation issue count message for validationIssues array limits', () => {
    const error = getZodError(
      z
        .object({
          validationIssues: z
            .array(
              z.object({
                code: z.string(),
              }),
            )
            .max(20),
        })
        .safeParse({
          validationIssues: Array.from({ length: 21 }, (_, index) => ({
            code: `issue-${index}`,
          })),
        }),
    );

    expect(toPublicErrorPayload(error)).toEqual({
      code: 'validation_error',
      error: 'Too many validation issues to send (max 20).',
      status: 400,
    });
  });

  it('returns the validation issue field message for oversized validationIssues entries', () => {
    const error = getZodError(
      z
        .object({
          validationIssues: z.array(
            z.object({
              message: z.string().max(10),
            }),
          ),
        })
        .safeParse({
          validationIssues: [
            {
              message: 'x'.repeat(11),
            },
          ],
        }),
    );

    expect(toPublicErrorPayload(error)).toEqual({
      code: 'validation_error',
      error: 'A validation issue field is too long.',
      status: 400,
    });
  });

  it('returns the chat history too_big message for nested chatHistory paths', () => {
    const error = getZodError(
      z
        .object({
          chatHistory: z.array(
            z.object({
              content: z.string().max(10),
            }),
          ),
        })
        .safeParse({
          chatHistory: [
            {
              content: 'x'.repeat(11),
            },
          ],
        }),
    );

    expect(toPublicErrorPayload(error)).toEqual({
      code: 'validation_error',
      error: 'Chat history is too large.',
      status: 400,
    });
  });

  it('falls back to the request body message for other too_big paths', () => {
    const error = getZodError(
      z
        .object({
          currentSource: z.string().max(10),
        })
        .safeParse({
          currentSource: 'x'.repeat(11),
        }),
    );

    expect(toPublicErrorPayload(error)).toEqual({
      code: 'validation_error',
      error: REQUEST_BODY_TOO_LARGE_PUBLIC_MESSAGE,
      status: 400,
    });
  });
});
