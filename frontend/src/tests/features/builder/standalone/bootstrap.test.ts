import { describe, expect, it } from 'vitest';
import { parseEmbeddedStandalonePayload, readEmbeddedStandalonePayload } from '@src/standalone/bootstrap';
import { STANDALONE_PAYLOAD_ELEMENT_ID } from '@features/builder/standalone/constants';

const validPayloadJson = JSON.stringify({
  version: 1,
  kind: 'kitto-standalone-openui-app',
  appId: 'v1-test1234',
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
      appId: 'v1-test1234',
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
      appId: 'v1-test1234',
      title: 'Standalone Quiz',
      createdAt: '2026-04-20T09:00:00.000Z',
      source: 'root = AppShell([])',
      initialRuntimeState: {},
      initialDomainData: {},
      storageKey: 'kitto:standalone:v1-test1234',
    });
  });
});
