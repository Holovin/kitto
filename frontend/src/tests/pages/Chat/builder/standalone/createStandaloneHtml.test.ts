import { afterEach, describe, expect, it, vi } from 'vitest';
import { STANDALONE_PAYLOAD_ELEMENT_ID, STANDALONE_ROOT_ELEMENT_ID } from '@pages/Chat/builder/standalone/constants';
import type { KittoStandalonePayload } from '@pages/Chat/builder/standalone/types';

const standalonePlayerJs = 'console.log("standalone player ready");';
const standalonePlayerCss = 'body{color:#111827;}';
function createPayload(overrides: Partial<KittoStandalonePayload> = {}): KittoStandalonePayload {
  return {
    version: 1,
    kind: 'kitto-standalone-openui-app',
    exportId: 'v1-test1234',
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

function mockStandalonePlayerModule({
  css = standalonePlayerCss,
  js = standalonePlayerJs,
}: {
  css?: string;
  js?: string;
} = {}) {
  const moduleFactory = vi.fn(() => ({
    STANDALONE_PLAYER_CSS: css,
    STANDALONE_PLAYER_JS: js,
  }));

  vi.doMock('@src/standalone/playerAssets.generated', moduleFactory);
  return moduleFactory;
}

describe('createStandaloneHtml', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('embeds the payload and the inline player assets from the generated module', async () => {
    mockStandalonePlayerModule();
    const { createStandaloneHtml } = await import('@pages/Chat/builder/standalone/createStandaloneHtml');
    const html = await createStandaloneHtml(createPayload());

    expect(standalonePlayerJs.length).toBeGreaterThan(0);
    expect(standalonePlayerCss.length).toBeGreaterThan(0);
    expect(html).toContain(`<div id="${STANDALONE_ROOT_ELEMENT_ID}"></div>`);
    expect(html).toContain(`<script id="${STANDALONE_PAYLOAD_ELEMENT_ID}" type="application/json">`);
    expect(html).toContain(standalonePlayerJs.slice(0, 32));
    expect(html).toContain(standalonePlayerCss.slice(0, 16));
    expect(html).not.toContain('window.__KITTO_STANDALONE_APP__');
  });

  it('places the inert payload script before the inline player script', async () => {
    mockStandalonePlayerModule();
    const { createStandaloneHtml } = await import('@pages/Chat/builder/standalone/createStandaloneHtml');
    const html = await createStandaloneHtml(createPayload());
    const payloadScriptStart = html.indexOf(`<script id="${STANDALONE_PAYLOAD_ELEMENT_ID}" type="application/json">`);
    const playerScriptStart = html.indexOf(`<script>\n${standalonePlayerJs.slice(0, 16)}`);

    expect(payloadScriptStart).toBeGreaterThan(-1);
    expect(playerScriptStart).toBeGreaterThan(-1);
    expect(payloadScriptStart).toBeLessThan(playerScriptStart);
  });

  it('escapes dangerous payload characters so inline data cannot break the script tag', async () => {
    mockStandalonePlayerModule();
    const { createStandaloneHtml } = await import('@pages/Chat/builder/standalone/createStandaloneHtml');
    const html = await createStandaloneHtml(
      createPayload({
        source: 'root = AppShell([Text("</script><script>alert(1)</script> & < >", "body", "start")])',
      }),
    );

    expect(html).toContain('\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e \\u0026 \\u003c \\u003e');
    expect(html).not.toContain('</script><script>alert(1)</script>');
  });

  it('serializes only the standalone app definition fields and excludes chat/history metadata', async () => {
    mockStandalonePlayerModule();
    const { createStandaloneHtml } = await import('@pages/Chat/builder/standalone/createStandaloneHtml');
    const html = await createStandaloneHtml({
      ...createPayload(),
      appId: 'legacy-test1234',
      chatHistory: [{ role: 'user', content: 'secret' }],
      history: [{ source: 'draft' }],
      redoHistory: [{ source: 'redo' }],
      versionHistory: [{ label: 'Version: 2 / 2' }],
      currentVersionLabel: 'Version: 2 / 2',
    } as KittoStandalonePayload & Record<string, unknown>);
    const embeddedPayloadJson = extractEmbeddedPayloadJson(html);

    expect(embeddedPayloadJson).toContain('"source":"root = AppShell([])"');
    expect(embeddedPayloadJson).toContain('"exportId":"v1-test1234"');
    expect(embeddedPayloadJson).not.toContain('"appId"');
    expect(embeddedPayloadJson).not.toContain('chatHistory');
    expect(embeddedPayloadJson).not.toContain('"history"');
    expect(embeddedPayloadJson).not.toContain('redoHistory');
    expect(embeddedPayloadJson).not.toContain('versionHistory');
    expect(embeddedPayloadJson).not.toContain('currentVersionLabel');
    expect(embeddedPayloadJson).not.toContain('secret');
    expect(embeddedPayloadJson).not.toContain('Version: 2 / 2');
  });

  it('escapes closing style and script tags inside inline player assets', async () => {
    mockStandalonePlayerModule({
      js: 'console.log("</script><script>boom</script>");',
      css: 'body::after{content:"</style><script>boom</script>";}',
    });

    const { createStandaloneHtml } = await import('@pages/Chat/builder/standalone/createStandaloneHtml');
    const html = await createStandaloneHtml(createPayload());

    expect(html).toContain('<\\/script>');
    expect(html).toContain('<\\/style>');
    expect(html).not.toContain('</style><script>boom</script>');
    expect(html).not.toContain('</script><script>boom</script>');
  });

  it('reuses the same loaded standalone player assets across exports', async () => {
    const moduleFactory = mockStandalonePlayerModule();
    const { createStandaloneHtml } = await import('@pages/Chat/builder/standalone/createStandaloneHtml');

    await createStandaloneHtml(createPayload());
    await createStandaloneHtml(createPayload({ exportId: 'v1-test5678', storageKey: 'kitto:standalone:v1-test5678' }));

    expect(moduleFactory).toHaveBeenCalledTimes(1);
  });

  it('does not touch fetch when exporting standalone html', async () => {
    const fetchMock = vi.fn();
    mockStandalonePlayerModule();
    vi.stubGlobal('fetch', fetchMock);
    const { createStandaloneHtml } = await import('@pages/Chat/builder/standalone/createStandaloneHtml');
    const html = await createStandaloneHtml(createPayload());

    expect(html).toContain(standalonePlayerJs);
    expect(html).toContain(standalonePlayerCss);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when the generated standalone player module is empty', async () => {
    mockStandalonePlayerModule({
      css: '   ',
      js: '',
    });
    const { createStandaloneHtml } = await import('@pages/Chat/builder/standalone/createStandaloneHtml');

    await expect(createStandaloneHtml(createPayload())).rejects.toThrow('Embedded standalone player CSS bundle was empty.');
  });
});
