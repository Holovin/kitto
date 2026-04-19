import { cloneJsonCompatibleValue, clonePlainObject } from '@features/builder/store/path';

export const KITTO_STANDALONE_PAYLOAD_VERSION = 1 as const;
export const KITTO_STANDALONE_PAYLOAD_KIND = 'kitto-standalone-openui-app' as const;
export const KITTO_STANDALONE_STORAGE_VERSION = 1 as const;
export const DEFAULT_STANDALONE_APP_TITLE = 'Kitto OpenUI App';

export type KittoStandalonePayload = {
  version: 1;
  kind: 'kitto-standalone-openui-app';
  appId: string;
  title: string;
  createdAt: string;
  source: string;
  initialRuntimeState: unknown;
  initialDomainData: Record<string, unknown>;
  storageKey: string;
};

export type StandaloneStoredState = {
  version: 1;
  runtimeState: unknown;
  domainData: Record<string, unknown>;
  updatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeStandaloneRuntimeState(value: unknown): Record<string, unknown> {
  try {
    const clonedValue = cloneJsonCompatibleValue(value);
    return isRecord(clonedValue) ? clonedValue : {};
  } catch {
    return {};
  }
}

export function normalizeStandaloneDomainData(value: unknown): Record<string, unknown> {
  try {
    return clonePlainObject(value, 'Standalone domain data must be a plain object.');
  } catch {
    return {};
  }
}

export function parseStandalonePayload(value: unknown): KittoStandalonePayload | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.version !== KITTO_STANDALONE_PAYLOAD_VERSION || value.kind !== KITTO_STANDALONE_PAYLOAD_KIND) {
    return null;
  }

  if (
    typeof value.appId !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.source !== 'string' ||
    typeof value.storageKey !== 'string'
  ) {
    return null;
  }

  try {
    return {
      version: KITTO_STANDALONE_PAYLOAD_VERSION,
      kind: KITTO_STANDALONE_PAYLOAD_KIND,
      appId: value.appId,
      title: value.title,
      createdAt: value.createdAt,
      source: value.source,
      initialRuntimeState: cloneJsonCompatibleValue(value.initialRuntimeState),
      initialDomainData: clonePlainObject(value.initialDomainData, 'Standalone domain data must be a plain object.'),
      storageKey: value.storageKey,
    };
  } catch {
    return null;
  }
}

export function createStandaloneStoredState(
  runtimeState: unknown,
  domainData: Record<string, unknown>,
): StandaloneStoredState {
  return {
    version: KITTO_STANDALONE_STORAGE_VERSION,
    runtimeState: normalizeStandaloneRuntimeState(runtimeState),
    domainData: normalizeStandaloneDomainData(domainData),
    updatedAt: new Date().toISOString(),
  };
}

export function parseStandaloneStoredState(value: unknown): StandaloneStoredState | null {
  if (!isRecord(value) || value.version !== KITTO_STANDALONE_STORAGE_VERSION || typeof value.updatedAt !== 'string') {
    return null;
  }

  return {
    version: KITTO_STANDALONE_STORAGE_VERSION,
    runtimeState: normalizeStandaloneRuntimeState(value.runtimeState),
    domainData: normalizeStandaloneDomainData(value.domainData),
    updatedAt: value.updatedAt,
  };
}
