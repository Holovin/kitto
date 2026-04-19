import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadStandaloneHtml } from '@features/builder/standalone/downloadStandaloneHtml';

describe('downloadStandaloneHtml', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates a Blob URL, clicks a temporary anchor, and revokes the URL', () => {
    const click = vi.fn();
    const remove = vi.fn();
    const anchor = {
      click,
      download: '',
      href: '',
      remove,
      style: {
        display: '',
      },
    } as unknown as HTMLAnchorElement;
    const appendChild = vi.fn();
    const createElement = vi.fn(() => anchor);
    const createObjectURL = vi.fn((blob: Blob) => {
      return blob instanceof Blob ? 'blob:kitto-standalone' : 'blob:invalid';
    });
    const revokeObjectURL = vi.fn();

    vi.stubGlobal('document', {
      body: {
        appendChild,
      },
      createElement,
    });
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    });

    downloadStandaloneHtml('<html></html>', 'kitto-app-2026-04-19.html');

    expect(createElement).toHaveBeenCalledWith('a');
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.download).toBe('kitto-app-2026-04-19.html');
    expect(anchor.href).toBe('blob:kitto-standalone');
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:kitto-standalone');
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    const [blob] = createObjectURL.mock.calls[0] ?? [];
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).type).toBe('text/html;charset=utf-8');
  });
});
