import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'sanitize.css';
import type { KittoStandalonePayload } from '@features/builder/standalone/types';
import { StandaloneApp } from './StandaloneApp';
import '../index.css';

declare global {
  interface Window {
    __KITTO_STANDALONE_APP__?: KittoStandalonePayload;
  }
}

const rootElement = document.getElementById('kitto-standalone-root');

if (!rootElement) {
  throw new Error('Standalone player root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <StandaloneApp payload={window.__KITTO_STANDALONE_APP__} />
  </StrictMode>,
);
