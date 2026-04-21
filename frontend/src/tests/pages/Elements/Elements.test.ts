import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@openuidev/react-lang', async () => {
  const actual = await vi.importActual<typeof import('@openuidev/react-lang')>('@openuidev/react-lang');

  return {
    ...actual,
    Renderer: () => createElement('div', { 'data-testid': 'mock-renderer' }),
  };
});

import ElementsPage from '@pages/Elements/Elements';

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

function setWindowHash(hash: string) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { hash },
    },
  });
}

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    return;
  }

  Reflect.deleteProperty(globalThis, 'window');
});

describe('ElementsPage', () => {
  it('renders the action catalog when the hash targets an action reference', () => {
    setWindowHash('#read-state');

    const markup = renderToStaticMarkup(createElement(ElementsPage));

    expect(markup).toContain('Actions');
    expect(markup).toContain('read_state(path)');
    expect(markup).toContain('Read stored value');
    expect(markup).toContain('Reads the current persisted value stored at the requested non-empty state path.');
    expect(markup).toContain('compute_value(op, input?, left?, right?, values?, options?, returnType?)');
  });
});
