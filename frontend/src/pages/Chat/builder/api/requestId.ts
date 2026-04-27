import { nanoid } from '@reduxjs/toolkit';
import { toBuilderRequestId, type BuilderRequestId } from '@pages/Chat/builder/types';

export function createRequestId(): BuilderRequestId {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return toBuilderRequestId(crypto.randomUUID());
  }

  return toBuilderRequestId(nanoid());
}
