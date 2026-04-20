import {
  STANDALONE_PAYLOAD_ELEMENT_ID,
  STANDALONE_PLAYER_CSS_PUBLIC_PATH,
  STANDALONE_PLAYER_JS_PUBLIC_PATH,
  STANDALONE_ROOT_ELEMENT_ID,
} from './constants';
import type { KittoStandalonePayload } from './types';

type StandalonePlayerAssets = {
  css: string;
  js: string;
};

let standalonePlayerAssetsPromise: Promise<StandalonePlayerAssets> | null = null;

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

function getPublicAssetUrl(fileName: string) {
  const baseUrl = import.meta.env.BASE_URL || '/';
  return `${baseUrl.replace(/\/?$/, '/')}${fileName}`;
}

async function readTextAsset(url: string, label: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Unable to load standalone player ${label} from ${url}.`);
  }

  const text = await response.text();
  const normalizedText = text.trimStart();

  if (!normalizedText) {
    throw new Error(`Standalone player ${label} at ${url} was empty.`);
  }

  // In Vite dev, a missing public asset can fall through to the SPA HTML shell
  // with a 200 response. Detect that case so we do not inline broken HTML.
  if (/^(<!doctype html>|<html[\s>]|<head[\s>]|<body[\s>])/i.test(normalizedText)) {
    throw new Error(`Standalone player ${label} at ${url} resolved to HTML instead of a text asset.`);
  }

  return text;
}

async function loadStandalonePlayerAssets() {
  if (!standalonePlayerAssetsPromise) {
    standalonePlayerAssetsPromise = Promise.all([
      readTextAsset(getPublicAssetUrl(STANDALONE_PLAYER_JS_PUBLIC_PATH), 'JavaScript bundle'),
      readTextAsset(getPublicAssetUrl(STANDALONE_PLAYER_CSS_PUBLIC_PATH), 'CSS bundle'),
    ])
      .then(([js, css]) => ({
        css,
        js,
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
