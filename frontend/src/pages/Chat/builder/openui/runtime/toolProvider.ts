import { builderActions } from '@pages/Chat/builder/store/builderSlice';
import { domainActions } from '@pages/Chat/builder/store/domainSlice';
import { store } from '@store/store';
import { createDomainToolProvider } from './createDomainToolProvider';

export const builderToolProvider = createDomainToolProvider({
  readDomainData: () => store.getState().domain.data,
  replaceDomainData: (nextData) => {
    store.dispatch(domainActions.replaceData(nextData));
    store.dispatch(builderActions.syncLatestSnapshotState({ domainData: nextData }));
  },
});
