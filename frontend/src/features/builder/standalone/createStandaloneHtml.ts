import { STANDALONE_PLAYER_CSS, STANDALONE_PLAYER_JS } from './playerAssets.generated';
import { STANDALONE_PAYLOAD_ELEMENT_ID, STANDALONE_ROOT_ELEMENT_ID } from './constants';
import type { KittoStandalonePayload } from './types';

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
    appId: payload.appId,
    title: payload.title,
    createdAt: payload.createdAt,
    source: payload.source,
    initialRuntimeState: payload.initialRuntimeState,
    initialDomainData: payload.initialDomainData,
    storageKey: payload.storageKey,
  };
}

export function createStandaloneHtml(payload: KittoStandalonePayload): string {
  const serializedPayload = serializeJsonForHtmlScript(createStandaloneHtmlPayload(payload));
  const standalonePlayerCss = escapeInlineTagContent(STANDALONE_PLAYER_CSS, 'style');
  const standalonePlayerJs = escapeInlineTagContent(STANDALONE_PLAYER_JS, 'script');
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
