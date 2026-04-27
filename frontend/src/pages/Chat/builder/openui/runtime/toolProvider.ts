import { createDomainToolProvider } from './createDomainToolProvider';

export type BuilderToolProviderAdapter = {
  readDomainData: () => Record<string, unknown>;
  replaceDomainData: (nextData: Record<string, unknown>) => void;
  syncLatestSnapshotDomainData: (nextData: Record<string, unknown>) => void;
};

export function createBuilderToolProvider(adapter: BuilderToolProviderAdapter) {
  return createDomainToolProvider({
    readDomainData: adapter.readDomainData,
    replaceDomainData: (nextData) => {
      adapter.replaceDomainData(nextData);
      adapter.syncLatestSnapshotDomainData(nextData);
    },
  });
}
