import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { useConfigQueryMock, useHealthQueryMock } = vi.hoisted(() => ({
  useConfigQueryMock: vi.fn(),
  useHealthQueryMock: vi.fn(() => ({ isError: true })),
}));

vi.mock('@api/apiSlice', () => ({
  useConfigQuery: useConfigQueryMock,
  useHealthQuery: useHealthQueryMock,
}));

import { BackendConnectionStateProvider } from '@pages/Chat/builder/context/backendConnectionState';
import { useBackendConnectionState } from '@pages/Chat/builder/hooks/useBuilderBootstrap';

function BackendConnectionStateProbe() {
  const { isError } = useBackendConnectionState();

  return createElement('span', null, String(isError));
}

describe('useBackendConnectionState', () => {
  afterEach(() => {
    useConfigQueryMock.mockReset();
    useHealthQueryMock.mockReset();
    useHealthQueryMock.mockReturnValue({ isError: true });
  });

  it('reuses the provided backend connection state instead of subscribing to health polling', () => {
    const html = renderToStaticMarkup(
      createElement(
        BackendConnectionStateProvider,
        { isError: false },
        createElement(BackendConnectionStateProbe),
      ),
    );

    expect(html).toContain('false');
    expect(useHealthQueryMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        skip: true,
      }),
    );
  });

  it('subscribes to health polling when no shared backend connection state exists', () => {
    const html = renderToStaticMarkup(createElement(BackendConnectionStateProbe));

    expect(html).toContain('true');
    expect(useHealthQueryMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        skip: false,
      }),
    );
  });
});
