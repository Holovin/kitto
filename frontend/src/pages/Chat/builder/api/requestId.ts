import { toBuilderRequestId, type BuilderRequestId } from '@pages/Chat/builder/types';

export function createRequestId(): BuilderRequestId {
  return toBuilderRequestId(crypto.randomUUID());
}
