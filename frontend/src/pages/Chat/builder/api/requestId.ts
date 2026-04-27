import { nanoid } from '@reduxjs/toolkit';
import type { BuilderRequestId } from '@pages/Chat/builder/types';

export function createRequestId(): BuilderRequestId {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return nanoid();
}
