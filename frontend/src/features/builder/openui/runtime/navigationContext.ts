import { createContext, useContext } from 'react';

export const OpenUiCurrentScreenIdContext = createContext<string | null>(null);

export function useCurrentScreenId() {
  return useContext(OpenUiCurrentScreenIdContext);
}
