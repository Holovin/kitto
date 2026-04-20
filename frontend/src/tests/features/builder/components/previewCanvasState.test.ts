import { describe, expect, it } from 'vitest';
import { resolvePreviewCanvasState } from '@features/builder/components/previewCanvasState';

describe('resolvePreviewCanvasState', () => {
  it('keeps rendering the committed preview when a rejected import exists but a valid preview source still exists', () => {
    expect(
      resolvePreviewCanvasState({
        isShowingRejectedDefinition: true,
        previewSource: 'root = AppShell([])',
      }),
    ).toBe('preview');
  });

  it('shows the unavailable state when there is no committed preview to fall back to', () => {
    expect(
      resolvePreviewCanvasState({
        isShowingRejectedDefinition: true,
        previewSource: '',
      }),
    ).toBe('unavailable');
  });

  it('shows the empty canvas state when nothing has been committed and there is no rejected definition', () => {
    expect(
      resolvePreviewCanvasState({
        isShowingRejectedDefinition: false,
        previewSource: '',
      }),
    ).toBe('empty');
  });
});
