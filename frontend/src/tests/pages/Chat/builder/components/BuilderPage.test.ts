import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const capturedProps = vi.hoisted(() => ({
  chatPanel: null as null | Record<string, unknown>,
  dispatch: vi.fn(),
  previewTabs: null as null | Record<string, unknown>,
}));

vi.mock('@pages/Chat/builder/components/ChatPanel', () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    capturedProps.chatPanel = props;
    return createElement('div', { 'data-testid': 'chat-panel' });
  },
}));

vi.mock('@pages/Chat/builder/components/PreviewTabs', () => ({
  PreviewTabs: (props: Record<string, unknown>) => {
    capturedProps.previewTabs = props;
    return createElement('div', { 'data-testid': 'preview-tabs' });
  },
}));

vi.mock('@store/hooks', () => ({
  useAppDispatch: () => capturedProps.dispatch,
}));

import { BuilderPage } from '@pages/Chat/builder/components/BuilderPage';

describe('BuilderPage', () => {
  beforeEach(() => {
    capturedProps.chatPanel = null;
    capturedProps.dispatch.mockClear();
    capturedProps.previewTabs = null;
  });

  it('does not pass active-generation cancel refs through layout children', () => {
    renderToStaticMarkup(createElement(BuilderPage));

    expect(capturedProps.chatPanel).not.toBeNull();
    expect(capturedProps.previewTabs).not.toBeNull();
    expect(capturedProps.chatPanel).not.toHaveProperty('cancelActiveRequestRef');
    expect(capturedProps.previewTabs).not.toHaveProperty('cancelActiveRequestRef');
    expect(capturedProps.chatPanel?.onSystemNotice).toEqual(expect.any(Function));
    expect(capturedProps.previewTabs?.onSystemNotice).toEqual(expect.any(Function));
  });

  it('clears backend connection status when a caller clears the system notice', () => {
    renderToStaticMarkup(createElement(BuilderPage));

    (capturedProps.chatPanel?.onSystemNotice as (notice: null) => void)(null);

    expect(capturedProps.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          messageKey: 'backend-connection-status',
        },
        type: 'builder/removeChatMessageByKey',
      }),
    );
  });
});
