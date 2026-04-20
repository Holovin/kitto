import { describe, expect, it, vi } from 'vitest';
import {
  blurStandaloneActiveIframeFocus,
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
});
