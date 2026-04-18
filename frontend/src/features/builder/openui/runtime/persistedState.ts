import { z } from 'zod';
import type { BuilderDefinitionExport, BuilderSnapshot } from '@features/builder/types';
import { DEFAULT_DOMAIN_DATA } from '@features/builder/store/defaults';

const looseRecordSchema = z.record(z.string(), z.unknown());

const builderSnapshotSchema = z.object({
  committedAt: z.string(),
  domainData: looseRecordSchema,
  initialDomainData: looseRecordSchema,
  initialRuntimeState: looseRecordSchema,
  runtimeState: looseRecordSchema,
  source: z.string(),
});

const builderDefinitionSchema = z.object({
  version: z.literal(1),
  source: z.string(),
  runtimeState: looseRecordSchema,
  domainData: looseRecordSchema,
  history: z.array(builderSnapshotSchema).default([]),
});

export function createBuilderSnapshot(
  source: string,
  runtimeState: Record<string, unknown>,
  domainData: Record<string, unknown>,
  baseline?: {
    initialDomainData?: Record<string, unknown>;
    initialRuntimeState?: Record<string, unknown>;
  },
): BuilderSnapshot {
  return {
    source,
    runtimeState: structuredClone(runtimeState),
    domainData: structuredClone(domainData),
    initialRuntimeState: structuredClone(baseline?.initialRuntimeState ?? runtimeState),
    initialDomainData: structuredClone(baseline?.initialDomainData ?? domainData),
    committedAt: new Date().toISOString(),
  };
}

function createDefinitionExport(
  source: string,
  runtimeState: Record<string, unknown>,
  domainData: Record<string, unknown>,
  history: BuilderSnapshot[],
): BuilderDefinitionExport {
  return {
    version: 1,
    source,
    runtimeState: structuredClone(runtimeState),
    domainData: structuredClone(domainData),
    history: structuredClone(history),
  };
}

export function createResetDefinitionExport(source: string, history: BuilderSnapshot[]): BuilderDefinitionExport {
  const latestSnapshot = history.at(-1);

  if (!latestSnapshot) {
    return createDefinitionExport(source, {}, DEFAULT_DOMAIN_DATA, [createBuilderSnapshot(source, {}, DEFAULT_DOMAIN_DATA)]);
  }

  const resetSnapshot = createBuilderSnapshot(source, latestSnapshot.initialRuntimeState, latestSnapshot.initialDomainData, {
    initialRuntimeState: latestSnapshot.initialRuntimeState,
    initialDomainData: latestSnapshot.initialDomainData,
  });

  return {
    version: 1,
    source,
    runtimeState: structuredClone(resetSnapshot.runtimeState),
    domainData: structuredClone(resetSnapshot.domainData),
    history: structuredClone([...history.slice(0, -1), resetSnapshot]),
  };
}

export function parseImportedDefinition(rawValue: string) {
  const parsedValue = builderDefinitionSchema.parse(JSON.parse(rawValue));
  const normalizedHistory =
    parsedValue.history.length > 0
      ? parsedValue.history.map((snapshot) => {
          return createBuilderSnapshot(snapshot.source, snapshot.runtimeState, snapshot.domainData, {
            initialRuntimeState: snapshot.initialRuntimeState,
            initialDomainData: snapshot.initialDomainData,
          });
        })
      : [createBuilderSnapshot(parsedValue.source, parsedValue.runtimeState, parsedValue.domainData)];

  return {
    ...parsedValue,
    history: normalizedHistory,
  };
}
