import { STANDALONE_PAYLOAD_ELEMENT_ID, STANDALONE_ROOT_ELEMENT_ID } from './constants';
import type { KittoStandalonePayload } from './types';

type StandalonePlayerAssets = {
  css: string;
  js: string;
};

let standalonePlayerAssetsPromise: Promise<StandalonePlayerAssets> | null = null;

function validateStandalonePlayerAsset(value: string, label: string) {
  if (!value.trim()) {
    throw new Error(`Embedded standalone player ${label} was empty.`);
  }

  return value;
}

function escapeHtmlText(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeInlineTagContent(value: string, tagName: 'script' | 'style') {
  return value.replace(new RegExp(`</${tagName}`, 'gi'), `<\\/${tagName}`);
}

async function loadStandalonePlayerAssets() {
  if (!standalonePlayerAssetsPromise) {
    standalonePlayerAssetsPromise = import('./playerAssets.generated')
      .then(({ STANDALONE_PLAYER_CSS, STANDALONE_PLAYER_JS }) => ({
        css: validateStandalonePlayerAsset(STANDALONE_PLAYER_CSS, 'CSS bundle'),
        js: validateStandalonePlayerAsset(STANDALONE_PLAYER_JS, 'JavaScript bundle'),
      }))
      .catch((error) => {
        standalonePlayerAssetsPromise = null;
        throw error;
      });
  }

  return standalonePlayerAssetsPromise;
}

export function serializeJsonForHtmlScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function createStandaloneHtmlPayload(payload: KittoStandalonePayload): KittoStandalonePayload {
  // Allowlist fields before embedding the payload in exported HTML
  return {
    version: payload.version,
    kind: payload.kind,
    exportId: payload.exportId,
    title: payload.title,
    createdAt: payload.createdAt,
    source: payload.source,
    initialRuntimeState: payload.initialRuntimeState,
    initialDomainData: payload.initialDomainData,
    storageKey: payload.storageKey,
  };
}

export function preloadStandalonePlayerAssets() {
  return loadStandalonePlayerAssets().then(() => undefined);
}

export async function createStandaloneHtml(payload: KittoStandalonePayload): Promise<string> {
  const serializedPayload = serializeJsonForHtmlScript(createStandaloneHtmlPayload(payload));
  const { css, js } = await loadStandalonePlayerAssets();
  const standalonePlayerCss = escapeInlineTagContent(css, 'style');
  const standalonePlayerJs = escapeInlineTagContent(js, 'script');
  const pageTitle = escapeHtmlText(payload.title || 'Kitto OpenUI App');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${pageTitle}</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>${standalonePlayerCss}</style>
  </head>
  <body>
    <div id="${STANDALONE_ROOT_ELEMENT_ID}"></div>
    <script id="${STANDALONE_PAYLOAD_ELEMENT_ID}" type="application/json">${serializedPayload}</script>
    <script>
${standalonePlayerJs}
    </script>
  </body>
</html>
`;
}
