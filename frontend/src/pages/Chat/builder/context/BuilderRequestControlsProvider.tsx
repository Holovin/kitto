import { useMemo, type ReactNode } from 'react';
import { BuilderRequestControlsContext, createBuilderRequestControls } from './builderRequestControls';

export function BuilderRequestControlsProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => createBuilderRequestControls(), []);

  return <BuilderRequestControlsContext.Provider value={value}>{children}</BuilderRequestControlsContext.Provider>;
}
