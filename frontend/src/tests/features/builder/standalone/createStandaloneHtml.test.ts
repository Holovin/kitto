import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStandaloneHtml } from '@features/builder/standalone/createStandaloneHtml';
import { STANDALONE_PAYLOAD_ELEMENT_ID, STANDALONE_ROOT_ELEMENT_ID } from '@features/builder/standalone/constants';
import { STANDALONE_PLAYER_CSS, STANDALONE_PLAYER_JS } from '@features/builder/standalone/playerAssets.generated';
import type { KittoStandalonePayload } from '@features/builder/standalone/types';

function createPayload(overrides: Partial<KittoStandalonePayload> = {}): KittoStandalonePayload {
  return {
    version: 1,
    kind: 'kitto-standalone-openui-app',
    appId: 'v1-test1234',
    title: 'Standalone Quiz',
    createdAt: '2026-04-19T08:15:00.000Z',
    source: 'root = AppShell([])',
    initialRuntimeState: { currentScreen: 'intro' },
    initialDomainData: { app: { answers: [] as string[] } },
    storageKey: 'kitto:standalone:v1-test1234',
    ...overrides,
  };
}

function extractEmbeddedPayloadJson(html: string) {
  const payloadScriptStart = html.indexOf(`<script id="${STANDALONE_PAYLOAD_ELEMENT_ID}" type="application/json">`);
  const payloadScriptEnd = html.indexOf('</script>', payloadScriptStart);

  expect(payloadScriptStart).toBeGreaterThan(-1);
  expect(payloadScriptEnd).toBeGreaterThan(payloadScriptStart);

  return html
    .slice(payloadScriptStart, payloadScriptEnd)
    .replace(`<script id="${STANDALONE_PAYLOAD_ELEMENT_ID}" type="application/json">`, '')
    .trim();
}

describe('createStandaloneHtml', () => {
  afterEach(() => {
    vi.doUnmock('@features/builder/standalone/playerAssets.generated');
    vi.resetModules();
  });

  it('embeds the payload and the generated inline player assets', () => {
    const html = createStandaloneHtml(createPayload());

    expect(STANDALONE_PLAYER_JS.length).toBeGreaterThan(0);
    expect(STANDALONE_PLAYER_CSS.length).toBeGreaterThan(0);
    expect(html).toContain(`<div id="${STANDALONE_ROOT_ELEMENT_ID}"></div>`);
    expect(html).toContain(`<script id="${STANDALONE_PAYLOAD_ELEMENT_ID}" type="application/json">`);
    expect(html).toContain(STANDALONE_PLAYER_JS.slice(0, 32));
    expect(html).toContain(STANDALONE_PLAYER_CSS.slice(0, 32));
    expect(html).not.toContain('window.__KITTO_STANDALONE_APP__');
  });

  it('places the inert payload script before the inline player script', () => {
    const html = createStandaloneHtml(createPayload());
    const payloadScriptStart = html.indexOf(`<script id="${STANDALONE_PAYLOAD_ELEMENT_ID}" type="application/json">`);
    const playerScriptStart = html.indexOf(`<script>\n${STANDALONE_PLAYER_JS.slice(0, 16)}`);

    expect(payloadScriptStart).toBeGreaterThan(-1);
    expect(playerScriptStart).toBeGreaterThan(-1);
    expect(payloadScriptStart).toBeLessThan(playerScriptStart);
  });

  it('escapes dangerous payload characters so inline data cannot break the script tag', () => {
    const html = createStandaloneHtml(
      createPayload({
        source: 'root = AppShell([Text("</script><script>alert(1)</script> & < >", "body", "start")])',
      }),
    );

    expect(html).toContain('\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e \\u0026 \\u003c \\u003e');
    expect(html).not.toContain('</script><script>alert(1)</script>');
  });

  it('serializes only the standalone app definition fields and excludes chat/history metadata', () => {
    const html = createStandaloneHtml({
      ...createPayload(),
      chatHistory: [{ role: 'user', content: 'secret' }],
      history: [{ source: 'draft' }],
      redoHistory: [{ source: 'redo' }],
      versionHistory: [{ label: 'Version: 2 / 2' }],
      currentVersionLabel: 'Version: 2 / 2',
    } as KittoStandalonePayload & Record<string, unknown>);
    const embeddedPayloadJson = extractEmbeddedPayloadJson(html);

    expect(embeddedPayloadJson).toContain('"source":"root = AppShell([])"');
    expect(embeddedPayloadJson).not.toContain('chatHistory');
    expect(embeddedPayloadJson).not.toContain('"history"');
    expect(embeddedPayloadJson).not.toContain('redoHistory');
    expect(embeddedPayloadJson).not.toContain('versionHistory');
    expect(embeddedPayloadJson).not.toContain('currentVersionLabel');
    expect(embeddedPayloadJson).not.toContain('secret');
    expect(embeddedPayloadJson).not.toContain('Version: 2 / 2');
  });

  it('escapes closing style and script tags inside inline player assets', async () => {
    vi.doMock('@features/builder/standalone/playerAssets.generated', () => ({
      STANDALONE_PLAYER_JS: 'console.log("</script><script>boom</script>");',
      STANDALONE_PLAYER_CSS: 'body::after{content:"</style><script>boom</script>";}',
    }));

    const { createStandaloneHtml: createMockedStandaloneHtml } = await import('@features/builder/standalone/createStandaloneHtml');
    const html = createMockedStandaloneHtml(createPayload());

    expect(html).toContain('<\\/script>');
    expect(html).toContain('<\\/style>');
    expect(html).not.toContain('</style><script>boom</script>');
    expect(html).not.toContain('</script><script>boom</script>');
  });
});
