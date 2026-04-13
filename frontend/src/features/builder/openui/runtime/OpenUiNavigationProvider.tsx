import type { PropsWithChildren } from 'react';
import { normalizeCurrentScreenId } from '@features/builder/store/navigation';
import { OpenUiCurrentScreenIdContext } from './navigationContext';

interface OpenUiNavigationProviderProps {
  currentScreenId?: string | null;
}

export function OpenUiNavigationProvider({
  children,
  currentScreenId,
}: PropsWithChildren<OpenUiNavigationProviderProps>) {
  return (
    <OpenUiCurrentScreenIdContext.Provider value={normalizeCurrentScreenId(currentScreenId)}>
      {children}
    </OpenUiCurrentScreenIdContext.Provider>
  );
}
