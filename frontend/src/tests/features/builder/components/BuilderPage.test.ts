import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const capturedProps = vi.hoisted(() => ({
  chatPanel: null as null | Record<string, unknown>,
  previewTabs: null as null | Record<string, unknown>,
}));

vi.mock('@features/builder/components/ChatPanel', () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    capturedProps.chatPanel = props;
    return createElement('div', { 'data-testid': 'chat-panel' });
  },
}));

vi.mock('@features/builder/components/PreviewTabs', () => ({
  PreviewTabs: (props: Record<string, unknown>) => {
    capturedProps.previewTabs = props;
    return createElement('div', { 'data-testid': 'preview-tabs' });
  },
}));

vi.mock('@store/hooks', () => ({
  useAppDispatch: () => vi.fn(),
}));

import { BuilderPage } from '@features/builder/components/BuilderPage';

describe('BuilderPage', () => {
  beforeEach(() => {
    capturedProps.chatPanel = null;
    capturedProps.previewTabs = null;
  });

  it('shares one active-generation cancel ref between chat and preview controls', () => {
    renderToStaticMarkup(createElement(BuilderPage));

    expect(capturedProps.chatPanel).not.toBeNull();
    expect(capturedProps.previewTabs).not.toBeNull();
    expect(capturedProps.chatPanel?.cancelActiveRequestRef).toBe(capturedProps.previewTabs?.cancelActiveRequestRef);
    expect(capturedProps.chatPanel?.cancelActiveRequestRef).toEqual(expect.objectContaining({ current: null }));
  });
});
