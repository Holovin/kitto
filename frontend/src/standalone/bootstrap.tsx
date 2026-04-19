import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { parseStandalonePayload, type KittoStandalonePayload } from '@features/builder/standalone/types';
import { STANDALONE_PAYLOAD_ELEMENT_ID, STANDALONE_ROOT_ELEMENT_ID } from '@features/builder/standalone/constants';
import { StandaloneApp } from './StandaloneApp';

type StandaloneDocument = Pick<Document, 'body' | 'createElement' | 'getElementById'>;

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
