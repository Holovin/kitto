/* eslint-disable react-refresh/only-export-components */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { parseStandalonePayload, type KittoStandalonePayload } from '@features/builder/standalone/types';
import { STANDALONE_PAYLOAD_ELEMENT_ID, STANDALONE_ROOT_ELEMENT_ID } from '@features/builder/standalone/constants';
import { StandaloneApp } from './StandaloneApp';

type StandaloneDocument = Pick<
  Document,
  'activeElement' | 'addEventListener' | 'body' | 'createElement' | 'getElementById' | 'removeEventListener'
>;
type StandaloneLocation = Pick<Location, 'protocol'> | undefined;

function StandaloneBootstrapFallback({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f5ef] p-5 text-slate-900 sm:p-6">
      <div className="w-full max-w-lg rounded-[1.5rem] border border-rose-200 bg-white/95 px-5 py-4 shadow-sm">
        <p className="text-sm font-semibold text-rose-700">Standalone app error</p>
        <p className="mt-2 text-sm leading-6 text-slate-700">{message}</p>
      </div>
    </div>
  );
}

export function parseEmbeddedStandalonePayload(rawValue: string | null | undefined): KittoStandalonePayload | null {
  if (!rawValue) {
    return null;
  }

  try {
    return parseStandalonePayload(JSON.parse(rawValue));
  } catch {
    return null;
  }
}

export function readEmbeddedStandalonePayload(standaloneDocument: Pick<Document, 'getElementById'> = document) {
  return parseEmbeddedStandalonePayload(standaloneDocument.getElementById(STANDALONE_PAYLOAD_ELEMENT_ID)?.textContent);
}

function isIframeElement(element: Element | null | undefined) {
  if (!element) {
    return false;
  }

  if (typeof HTMLIFrameElement === 'function' && element instanceof HTMLIFrameElement) {
    return true;
  }

  return element.tagName === 'IFRAME';
}

export function blurStandaloneActiveIframeFocus(
  standaloneDocument: Pick<Document, 'activeElement'> = document,
  standaloneLocation: StandaloneLocation = globalThis.location,
) {
  if (standaloneLocation?.protocol !== 'file:') {
    return false;
  }

  const activeElement = standaloneDocument.activeElement as (Element & { blur?: () => void }) | null;

  if (!isIframeElement(activeElement) || typeof activeElement?.blur !== 'function') {
    return false;
  }

  activeElement.blur();
  return true;
}

export function installStandaloneIframeFocusGuard(
  standaloneDocument: Pick<Document, 'activeElement' | 'addEventListener' | 'removeEventListener'> = document,
  standaloneLocation: StandaloneLocation = globalThis.location,
) {
  if (standaloneLocation?.protocol !== 'file:') {
    return () => {};
  }

  const handleFocusIn = () => {
    blurStandaloneActiveIframeFocus(standaloneDocument, standaloneLocation);
  };

  standaloneDocument.addEventListener('focusin', handleFocusIn, true);
  handleFocusIn();

  return () => {
    standaloneDocument.removeEventListener('focusin', handleFocusIn, true);
  };
}

function renderStandaloneBootstrapError(message: string, rootElement: HTMLElement | null, standaloneDocument: StandaloneDocument) {
  const mountElement =
    rootElement ??
    (() => {
      const bodyElement = standaloneDocument.body;

      if (!bodyElement) {
        throw new Error(message);
      }

      const fallbackElement = standaloneDocument.createElement('div');
      bodyElement.appendChild(fallbackElement);
      return fallbackElement;
    })();

  createRoot(mountElement).render(
    <StrictMode>
      <StandaloneBootstrapFallback message={message} />
    </StrictMode>,
  );
}

export function mountStandaloneApp(standaloneDocument: StandaloneDocument = document) {
  // React checks the deeply focused element during commits. On file:// pages,
  // browser- or extension-owned iframes can trigger a noisy cross-origin warning.
  installStandaloneIframeFocusGuard(standaloneDocument);

  const rootElement = standaloneDocument.getElementById(STANDALONE_ROOT_ELEMENT_ID);

  if (!rootElement) {
    renderStandaloneBootstrapError('Missing standalone root element.', null, standaloneDocument);
    return;
  }

  const payload = readEmbeddedStandalonePayload(standaloneDocument);

  if (!payload) {
    renderStandaloneBootstrapError('Missing or invalid standalone payload.', rootElement, standaloneDocument);
    return;
  }

  createRoot(rootElement).render(
    <StrictMode>
      <StandaloneApp payload={payload} />
    </StrictMode>,
  );
}
