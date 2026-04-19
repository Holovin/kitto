import { z } from 'zod';
import type { BuilderDefinitionExport, BuilderSnapshot } from '@features/builder/types';
import { DEFAULT_DOMAIN_DATA } from '@features/builder/store/defaults';
import { validateOpenUiSource } from './validation';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseBuilderDefinitionExport(rawValue: string) {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(rawValue);
  } catch {
    throw new Error('Import file is not valid JSON.');
  }

  if (!isRecord(parsedJson)) {
    throw new Error('Import file must contain a Kitto definition export object.');
  }

  if (parsedJson.version !== 1) {
    const versionLabel =
      typeof parsedJson.version === 'number' || typeof parsedJson.version === 'string'
        ? `version ${String(parsedJson.version)}`
        : 'an unsupported format';

    throw new Error(`Import file uses ${versionLabel}. Expected a Kitto definition export with version 1.`);
  }

  const parsedValue = builderDefinitionSchema.safeParse(parsedJson);

  if (!parsedValue.success) {
    throw new Error('Import file is not a valid Kitto definition export.');
  }

  return parsedValue.data;
}

function isValidDefinitionSource(source: string) {
  return validateOpenUiSource(source).isValid;
}

function sanitizeDefinitionHistory(history: BuilderSnapshot[]) {
  return history.filter((snapshot) => isValidDefinitionSource(snapshot.source));
}

function normalizeSnapshot(snapshot: BuilderSnapshot) {
  return createBuilderSnapshot(snapshot.source, snapshot.runtimeState, snapshot.domainData, {
    initialRuntimeState: snapshot.initialRuntimeState,
    initialDomainData: snapshot.initialDomainData,
  });
}

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
  const sanitizedHistory = sanitizeDefinitionHistory(history);

  return {
    version: 1,
    source,
    runtimeState: structuredClone(runtimeState),
    domainData: structuredClone(domainData),
    history: structuredClone(
      sanitizedHistory.length > 0 ? sanitizedHistory : [createBuilderSnapshot(source, runtimeState, domainData)],
    ),
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

  return createDefinitionExport(
    source,
    resetSnapshot.runtimeState,
    resetSnapshot.domainData,
    [...history.slice(0, -1), resetSnapshot],
  );
}

export function parseImportedDefinition(rawValue: string) {
  const parsedValue = parseBuilderDefinitionExport(rawValue);
  const normalizedHistory =
    parsedValue.history.length > 0
      ? parsedValue.history.map((snapshot) => normalizeSnapshot(snapshot))
      : [createBuilderSnapshot(parsedValue.source, parsedValue.runtimeState, parsedValue.domainData)];

  return {
    ...parsedValue,
    history: normalizedHistory,
  };
}
