import { isPlainObject } from '@kitto-openui/shared/objectGuards.js';
import type { BuilderSnapshot } from '@pages/Chat/builder/types';
import { clonePersistedDomainData } from '@pages/Chat/builder/store/path';
import { isElementNode, parser, visitOpenUiValue } from './validation/shared';

const NAVIGATION_STATE_KEY = 'navigation';
const CURRENT_SCREEN_ID_KEY = 'currentScreenId';
const CURRENT_SCREEN_STATE_REF = '$currentScreen';
const HOME_SCREEN_ID = 'home';

interface NavigationSourceInfo {
  fallbackScreenId: string | null;
  screenIds: string[];
}

interface NavigationRecoveryResult {
  didRecover: boolean;
  domainData: Record<string, unknown>;
}

function collectScreenIdsFromRoot(root: unknown) {
  const screenIds: string[] = [];

  visitOpenUiValue(root, (node) => {
    if (!isElementNode(node) || node.typeName !== 'Screen' || typeof node.props.id !== 'string') {
      return;
    }

    screenIds.push(node.props.id);
  });

  return screenIds;
}

function getNavigationSourceInfo(source: string): NavigationSourceInfo {
  const result = parser.parse(source);

  if (result.meta.incomplete || result.meta.errors.length > 0 || !result.root) {
    return {
      fallbackScreenId: null,
      screenIds: [],
    };
  }

  const screenIds = collectScreenIdsFromRoot(result.root);
  const screenIdSet = new Set(screenIds);
  const currentScreenInitialValue = result.stateDeclarations?.[CURRENT_SCREEN_STATE_REF];
  const fallbackScreenId =
    typeof currentScreenInitialValue === 'string' && screenIdSet.has(currentScreenInitialValue)
      ? currentScreenInitialValue
      : screenIdSet.has(HOME_SCREEN_ID)
        ? HOME_SCREEN_ID
        : screenIds[0] ?? null;

  return {
    fallbackScreenId,
    screenIds,
  };
}

function getCurrentNavigationScreenId(domainData: Record<string, unknown>) {
  const navigation = domainData[NAVIGATION_STATE_KEY];

  if (!isPlainObject(navigation)) {
    return null;
  }

  const currentScreenId = navigation[CURRENT_SCREEN_ID_KEY];

  return typeof currentScreenId === 'string' && currentScreenId.trim() ? currentScreenId : null;
}

export function collectScreenIds(source: string) {
  return getNavigationSourceInfo(source).screenIds;
}

export function inferFallbackScreenId(source: string) {
  return getNavigationSourceInfo(source).fallbackScreenId;
}

export function recoverStaleNavigationDomainData(
  source: string,
  domainData: Record<string, unknown>,
): NavigationRecoveryResult {
  const currentScreenId = getCurrentNavigationScreenId(domainData);

  if (!currentScreenId) {
    return {
      didRecover: false,
      domainData,
    };
  }

  const { fallbackScreenId, screenIds } = getNavigationSourceInfo(source);

  if (screenIds.includes(currentScreenId)) {
    return {
      didRecover: false,
      domainData,
    };
  }

  const nextDomainData = clonePersistedDomainData(domainData);
  const currentNavigation = nextDomainData[NAVIGATION_STATE_KEY];
  const nextNavigation = isPlainObject(currentNavigation) ? { ...currentNavigation } : {};

  if (fallbackScreenId) {
    nextNavigation[CURRENT_SCREEN_ID_KEY] = fallbackScreenId;
  } else {
    delete nextNavigation[CURRENT_SCREEN_ID_KEY];
  }

  nextDomainData[NAVIGATION_STATE_KEY] = nextNavigation;

  return {
    didRecover: true,
    domainData: nextDomainData,
  };
}

export function recoverStaleNavigationSnapshot(snapshot: BuilderSnapshot): BuilderSnapshot {
  const recoveredDomainData = recoverStaleNavigationDomainData(snapshot.source, snapshot.domainData);
  const recoveredInitialDomainData = recoverStaleNavigationDomainData(snapshot.source, snapshot.initialDomainData);

  if (!recoveredDomainData.didRecover && !recoveredInitialDomainData.didRecover) {
    return snapshot;
  }

  return {
    ...snapshot,
    domainData: recoveredDomainData.domainData,
    initialDomainData: recoveredInitialDomainData.domainData,
  };
}
