import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@store/hooks', () => ({
  useAppDispatch: () => vi.fn(),
}));

import { PreviewEmptyState } from '@features/builder/components/PreviewEmptyState';

describe('PreviewEmptyState', () => {
  it('renders prompt and demo cards with decorative lucide icons', () => {
    const markup = renderToStaticMarkup(createElement(PreviewEmptyState));

    expect(markup).toContain('Try these prompts');
    expect(markup).toContain('Or load an already generated app');
    expect(markup).toContain('overflow-hidden');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('data-preview-card-icon="prompt"');
    expect(markup).toContain('data-preview-card-icon="demo"');
    expect(markup).toContain('data-preview-card-gradient="prompt"');
    expect(markup).toContain('data-preview-card-gradient="demo"');
    expect(markup).not.toContain('✅');
  });

  it('renders the animal explorer demo first in the already generated section', () => {
    const markup = renderToStaticMarkup(createElement(PreviewEmptyState));
    const [, demoSection] = markup.split('Or load an already generated app');

    expect(demoSection).toBeDefined();
    expect(demoSection.match(/Animal explorer|Todo list|Quiz with 3 questions/g)).toEqual([
      'Animal explorer',
      'Todo list',
      'Quiz with 3 questions',
    ]);
  });
});
