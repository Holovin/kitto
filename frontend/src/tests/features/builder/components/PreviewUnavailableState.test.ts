import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PreviewUnavailableState } from '@features/builder/components/PreviewUnavailableState';

describe('PreviewUnavailableState', () => {
  it('renders an unavailable preview message with light error styling', () => {
    const markup = renderToStaticMarkup(createElement(PreviewUnavailableState));

    expect(markup).toContain('Preview is unavailable');
    expect(markup).toContain('Definition tab');
    expect(markup).toContain('bg-rose-100/90');
    expect(markup).toContain('text-rose-400');
  });
});
