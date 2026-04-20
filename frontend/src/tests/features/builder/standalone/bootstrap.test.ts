import { describe, expect, it, vi } from 'vitest';
import {
  blurStandaloneActiveIframeFocus,
  installStandaloneIframeFocusGuard,
  parseEmbeddedStandalonePayload,
  readEmbeddedStandalonePayload,
} from '@src/standalone/bootstrap';
import { STANDALONE_PAYLOAD_ELEMENT_ID } from '@features/builder/standalone/constants';

const validPayloadJson = JSON.stringify({
  version: 1,
  kind: 'kitto-standalone-openui-app',
  exportId: 'v1-test1234',
  title: 'Standalone Quiz',
  createdAt: '2026-04-20T09:00:00.000Z',
  source: 'root = AppShell([])',
  initialRuntimeState: {},
  initialDomainData: {},
  storageKey: 'kitto:standalone:v1-test1234',
});

describe('standalone bootstrap payload helpers', () => {
  it('parses a valid embedded payload JSON string', () => {
    expect(parseEmbeddedStandalonePayload(validPayloadJson)).toEqual({
      version: 1,
      kind: 'kitto-standalone-openui-app',
      exportId: 'v1-test1234',
      title: 'Standalone Quiz',
      createdAt: '2026-04-20T09:00:00.000Z',
      source: 'root = AppShell([])',
      initialRuntimeState: {},
      initialDomainData: {},
      storageKey: 'kitto:standalone:v1-test1234',
    });
  });

  it('returns null for invalid embedded payload JSON', () => {
    expect(parseEmbeddedStandalonePayload('{not-json')).toBeNull();
    expect(parseEmbeddedStandalonePayload(JSON.stringify({ version: 1 }))).toBeNull();
    expect(
      parseEmbeddedStandalonePayload(
        JSON.stringify({
          version: 1,
          kind: 'kitto-standalone-openui-app',
          appId: 'v1-legacy1234',
          title: 'Standalone Quiz',
          createdAt: '2026-04-20T09:00:00.000Z',
          source: 'root = AppShell([])',
          initialRuntimeState: {},
          initialDomainData: {},
          storageKey: 'kitto:standalone:v1-legacy1234',
        }),
      ),
    ).toBeNull();
    expect(parseEmbeddedStandalonePayload('')).toBeNull();
  });

  it('reads the payload from the standalone payload script element', () => {
    const standaloneDocument = {
      getElementById(id: string) {
        if (id !== STANDALONE_PAYLOAD_ELEMENT_ID) {
          return null;
        }

        return { textContent: validPayloadJson } as HTMLElement;
      },
    };

    expect(readEmbeddedStandalonePayload(standaloneDocument)).toEqual({
      version: 1,
      kind: 'kitto-standalone-openui-app',
      exportId: 'v1-test1234',
      title: 'Standalone Quiz',
      createdAt: '2026-04-20T09:00:00.000Z',
      source: 'root = AppShell([])',
      initialRuntimeState: {},
      initialDomainData: {},
      storageKey: 'kitto:standalone:v1-test1234',
    });
  });

  it('blurs an active iframe when standalone HTML runs from file protocol', () => {
    const blur = vi.fn();

    expect(
      blurStandaloneActiveIframeFocus(
        {
          activeElement: {
            blur,
            tagName: 'IFRAME',
          } as unknown as Element,
        },
        { protocol: 'file:' },
      ),
    ).toBe(true);

    expect(blur).toHaveBeenCalledTimes(1);
  });

  it('does not blur non-iframe elements or non-file runtimes', () => {
    const bodyBlur = vi.fn();
    const iframeBlur = vi.fn();

    expect(
      blurStandaloneActiveIframeFocus(
        {
          activeElement: {
            blur: bodyBlur,
            tagName: 'BODY',
          } as unknown as Element,
        },
        { protocol: 'file:' },
      ),
    ).toBe(false);
    expect(bodyBlur).not.toHaveBeenCalled();

    expect(
      blurStandaloneActiveIframeFocus(
        {
          activeElement: {
            blur: iframeBlur,
            tagName: 'IFRAME',
          } as unknown as Element,
        },
        { protocol: 'https:' },
      ),
    ).toBe(false);
    expect(iframeBlur).not.toHaveBeenCalled();
  });

  it('installs a file-protocol focus guard that keeps iframe focus from sticking', () => {
    const initialBlur = vi.fn();
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const standaloneDocument = {
      activeElement: {
        blur: initialBlur,
        tagName: 'IFRAME',
      } as unknown as Element,
      addEventListener,
      removeEventListener,
    };

    const cleanup = installStandaloneIframeFocusGuard(standaloneDocument, { protocol: 'file:' });

    expect(initialBlur).toHaveBeenCalledTimes(1);
    expect(addEventListener).toHaveBeenCalledTimes(1);
    expect(addEventListener).toHaveBeenCalledWith('focusin', expect.any(Function), true);

    const focusInHandler = addEventListener.mock.calls[0]?.[1];
    const laterBlur = vi.fn();
    standaloneDocument.activeElement = {
      blur: laterBlur,
      tagName: 'IFRAME',
    } as unknown as Element;

    focusInHandler?.(new Event('focusin'));
    expect(laterBlur).toHaveBeenCalledTimes(1);

    cleanup();
    expect(removeEventListener).toHaveBeenCalledWith('focusin', focusInHandler, true);
  });

  it('skips the focus guard outside file protocol', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();

    const cleanup = installStandaloneIframeFocusGuard(
      {
        activeElement: null,
        addEventListener,
        removeEventListener,
      },
      { protocol: 'https:' },
    );

    cleanup();

    expect(addEventListener).not.toHaveBeenCalled();
    expect(removeEventListener).not.toHaveBeenCalled();
  });
});
