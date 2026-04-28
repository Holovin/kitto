import { describe, expect, it } from 'vitest';
import {
  collectScreenIds,
  inferFallbackScreenId,
  recoverStaleNavigationDomainData,
} from '@pages/Chat/builder/openui/runtime/navigationRecovery';

const sourceWithCurrentScreen = `$currentScreen = "home"
root = AppShell([
  Screen("home", "Home", [
    Text("Home", "body", "start")
  ], $currentScreen == "home"),
  Screen("details", "Details", [
    Text("Details", "body", "start")
  ], $currentScreen == "details")
])`;

describe('navigationRecovery', () => {
  it('collects screen ids from the committed source', () => {
    expect(collectScreenIds(sourceWithCurrentScreen)).toEqual(['home', 'details']);
  });

  it('infers the declared current screen when it still exists', () => {
    expect(inferFallbackScreenId(sourceWithCurrentScreen)).toBe('home');
  });

  it('falls back to home and then the first screen', () => {
    expect(
      inferFallbackScreenId(`$currentScreen = "missing"
root = AppShell([
  Screen("home", "Home", []),
  Screen("details", "Details", [])
])`),
    ).toBe('home');

    expect(
      inferFallbackScreenId(`root = AppShell([
  Screen("details", "Details", []),
  Screen("summary", "Summary", [])
])`),
    ).toBe('details');
  });

  it('repairs only stale navigation currentScreenId values', () => {
    const validDomainData = {
      navigation: {
        currentScreenId: 'details',
      },
    };
    const unchanged = recoverStaleNavigationDomainData(sourceWithCurrentScreen, validDomainData);

    expect(unchanged.didRecover).toBe(false);
    expect(unchanged.domainData).toBe(validDomainData);

    const stale = recoverStaleNavigationDomainData(sourceWithCurrentScreen, {
      navigation: {
        currentScreenId: 'deleted',
        sidebarOpen: true,
      },
    });

    expect(stale.didRecover).toBe(true);
    expect(stale.domainData).toEqual({
      navigation: {
        currentScreenId: 'home',
        sidebarOpen: true,
      },
    });
  });

  it('deletes currentScreenId when no fallback screen exists', () => {
    const recovered = recoverStaleNavigationDomainData('root = AppShell([])', {
      navigation: {
        currentScreenId: 'deleted',
        sidebarOpen: true,
      },
    });

    expect(recovered.didRecover).toBe(true);
    expect(recovered.domainData).toEqual({
      navigation: {
        sidebarOpen: true,
      },
    });
  });

  it('does not create navigation state when currentScreenId is absent', () => {
    const domainData = {
      app: {
        items: [],
      },
    };
    const recovered = recoverStaleNavigationDomainData(sourceWithCurrentScreen, domainData);

    expect(recovered.didRecover).toBe(false);
    expect(recovered.domainData).toBe(domainData);
  });
});
