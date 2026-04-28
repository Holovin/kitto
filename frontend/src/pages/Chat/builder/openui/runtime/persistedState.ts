import { z } from 'zod';
import { nanoid } from '@reduxjs/toolkit';
import {
  appMemorySchema,
  HISTORY_SUMMARY_MAX_CHARS,
  normalizeAppMemory,
  type AppMemory,
} from '@kitto-openui/shared/builderApiContract.js';
import { isRecord } from '@kitto-openui/shared/objectGuards.js';
import type { BuilderDefinitionExport, PromptBuildValidationIssue, BuilderSnapshot } from '@pages/Chat/builder/types';
import { DEFAULT_DOMAIN_DATA } from '@pages/Chat/builder/store/defaults';
import { clonePersistedDomainData, clonePersistedRuntimeState } from '@pages/Chat/builder/store/path';
import { validateOpenUiSource } from './validation';

const looseRecordSchema = z.record(z.string(), z.unknown());
export const MAX_REVISIONS = 15;
export const SUMMARY_MAX_CHARS = 200;
export const CHANGE_SUMMARY_MAX_CHARS = 300;

const builderSnapshotSchema = z.object({
  appMemory: z.unknown().optional(),
  committedAt: z.string(),
  changeSummary: z.string().optional(),
  createdAt: z.string().optional(),
  domainData: looseRecordSchema,
  historySummary: z.string().optional(),
  id: z.string().optional(),
  initialDomainData: looseRecordSchema,
  initialRuntimeState: looseRecordSchema,
  runtimeState: looseRecordSchema,
  source: z.string(),
  summary: z.string().optional(),
});

const builderDefinitionSchema = z.object({
  version: z.literal(1),
  source: z.string(),
  appMemory: z.unknown().optional(),
  runtimeState: looseRecordSchema,
  domainData: looseRecordSchema,
  history: z.array(builderSnapshotSchema).default([]),
});

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

function normalizeOptionalAppMemory(value: unknown): AppMemory | undefined {
  return appMemorySchema.safeParse(value).success ? normalizeAppMemory(value) : undefined;
}

function normalizeSnapshot(snapshot: z.infer<typeof builderSnapshotSchema>) {
  return createBuilderSnapshot(snapshot.source, snapshot.runtimeState, snapshot.domainData, {
    appMemory: normalizeOptionalAppMemory(snapshot.appMemory),
    changeSummary: snapshot.changeSummary ?? '',
    createdAt: snapshot.createdAt,
    historySummary: snapshot.historySummary,
    id: snapshot.id,
    initialRuntimeState: snapshot.initialRuntimeState,
    initialDomainData: snapshot.initialDomainData,
    summary: snapshot.summary ?? '',
  });
}

export function cloneBuilderSnapshot(snapshot: BuilderSnapshot): BuilderSnapshot {
  return {
    id: snapshot.id,
    source: snapshot.source,
    summary: snapshot.summary,
    changeSummary: snapshot.changeSummary,
    ...(snapshot.historySummary ? { historySummary: snapshot.historySummary } : {}),
    ...(snapshot.appMemory ? { appMemory: normalizeAppMemory(snapshot.appMemory) } : {}),
    createdAt: snapshot.createdAt,
    runtimeState: clonePersistedRuntimeState(snapshot.runtimeState),
    domainData: clonePersistedDomainData(snapshot.domainData),
    initialRuntimeState: clonePersistedRuntimeState(snapshot.initialRuntimeState),
    initialDomainData: clonePersistedDomainData(snapshot.initialDomainData),
    committedAt: snapshot.committedAt,
  };
}

export function createBuilderSnapshot(
  source: string,
  runtimeState: Record<string, unknown>,
  domainData: Record<string, unknown>,
  baseline?: {
    appMemory?: AppMemory;
    changeSummary?: string;
    createdAt?: string;
    historySummary?: string;
    id?: string;
    initialDomainData?: Record<string, unknown>;
    initialRuntimeState?: Record<string, unknown>;
    summary?: string;
  },
): BuilderSnapshot {
  const createdAt = baseline?.createdAt ?? new Date().toISOString();
  const normalizedAppMemory = baseline?.appMemory ? normalizeAppMemory(baseline.appMemory) : undefined;

  return {
    id: baseline?.id ?? nanoid(),
    source,
    summary: (baseline?.summary ?? '').trim().slice(0, SUMMARY_MAX_CHARS),
    changeSummary: (baseline?.changeSummary ?? '').trim().slice(0, CHANGE_SUMMARY_MAX_CHARS),
    ...(baseline?.historySummary ? { historySummary: baseline.historySummary.trim().slice(0, HISTORY_SUMMARY_MAX_CHARS) } : {}),
    ...(normalizedAppMemory ? { appMemory: normalizedAppMemory } : {}),
    createdAt,
    runtimeState: clonePersistedRuntimeState(runtimeState),
    domainData: clonePersistedDomainData(domainData),
    initialRuntimeState: clonePersistedRuntimeState(baseline?.initialRuntimeState ?? runtimeState),
    initialDomainData: clonePersistedDomainData(baseline?.initialDomainData ?? domainData),
    committedAt: createdAt,
  };
}

export function trimBuilderRevisions(history: BuilderSnapshot[]) {
  return history.slice(-MAX_REVISIONS);
}

function createDefinitionExport(
  source: string,
  appMemory: AppMemory | undefined,
  runtimeState: Record<string, unknown>,
  domainData: Record<string, unknown>,
  history: BuilderSnapshot[],
): BuilderDefinitionExport {
  const sanitizedHistory = sanitizeDefinitionHistory(history);

  return {
    version: 1,
    source,
    ...(appMemory ? { appMemory: normalizeAppMemory(appMemory) } : {}),
    runtimeState: clonePersistedRuntimeState(runtimeState),
    domainData: clonePersistedDomainData(domainData),
    history: trimBuilderRevisions(
      sanitizedHistory.length > 0 ? sanitizedHistory : [createBuilderSnapshot(source, runtimeState, domainData)],
    ).map((snapshot) => cloneBuilderSnapshot(snapshot)),
  };
}

export function createResetDefinitionExport(source: string, history: BuilderSnapshot[]): BuilderDefinitionExport {
  const latestSnapshot = history.at(-1);

  if (!latestSnapshot) {
    return createDefinitionExport(source, undefined, {}, DEFAULT_DOMAIN_DATA, [createBuilderSnapshot(source, {}, DEFAULT_DOMAIN_DATA)]);
  }

  const resetSnapshot = createBuilderSnapshot(source, latestSnapshot.initialRuntimeState, latestSnapshot.initialDomainData, {
    appMemory: latestSnapshot.appMemory,
    changeSummary: latestSnapshot.changeSummary,
    historySummary: latestSnapshot.historySummary,
    initialRuntimeState: latestSnapshot.initialRuntimeState,
    initialDomainData: latestSnapshot.initialDomainData,
    summary: latestSnapshot.summary,
  });

  return createDefinitionExport(
    source,
    resetSnapshot.appMemory,
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
      : [
          createBuilderSnapshot(parsedValue.source, parsedValue.runtimeState, parsedValue.domainData, {
            appMemory: normalizeOptionalAppMemory(parsedValue.appMemory),
          }),
        ];
  const appMemory = normalizeOptionalAppMemory(parsedValue.appMemory);

  return {
    version: parsedValue.version,
    source: parsedValue.source,
    runtimeState: parsedValue.runtimeState,
    domainData: parsedValue.domainData,
    ...(appMemory ? { appMemory } : {}),
    history: normalizedHistory,
  };
}

export type ResolvedImportedDefinition =
  | {
      definition: ReturnType<typeof parseImportedDefinition>;
      kind: 'invalid-source';
      issues: PromptBuildValidationIssue[];
    }
  | {
      definition: ReturnType<typeof parseImportedDefinition>;
      kind: 'valid';
    };

export function resolveImportedDefinition(rawValue: string): ResolvedImportedDefinition {
  const definition = parseImportedDefinition(rawValue);
  const sourceValidation = validateOpenUiSource(definition.source);

  if (!sourceValidation.isValid) {
    return {
      definition,
      kind: 'invalid-source',
      issues: sourceValidation.issues,
    };
  }

  return {
    definition,
    kind: 'valid',
  };
}
