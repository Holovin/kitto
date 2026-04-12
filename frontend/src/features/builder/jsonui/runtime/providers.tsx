import type { Spec } from '@json-render/core';
import { JSONUIProvider, Renderer } from '@json-render/react';
import { builderRegistry } from '../registry';
import { builderRuntimeFunctions } from './functions';
import { builderRuntimeHandlers, builderRuntimeStore } from './handlers';

type BuilderRuntimeProvidersProps = {
  spec: Spec | null;
  loading?: boolean;
};

export function BuilderRuntimeProviders({ spec, loading = false }: BuilderRuntimeProvidersProps) {
  if (!spec) {
    return null;
  }

  return (
    <JSONUIProvider
      registry={builderRegistry.registry}
      store={builderRuntimeStore}
      handlers={builderRuntimeHandlers}
      functions={builderRuntimeFunctions}
    >
      <div className="w-full min-w-0 [&>*]:block [&>*]:w-full [&>*]:max-w-none">
        <Renderer spec={spec} registry={builderRegistry.registry} loading={loading} />
      </div>
    </JSONUIProvider>
  );
}
