import { createElement, type CSSProperties } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select';

type ThemedStyle = CSSProperties & {
  '--kitto-contrast-color': string;
  '--kitto-main-color': string;
};

describe('SelectContent', () => {
  it('uses a white fallback surface when no theme variables are provided', () => {
    const html = renderToStaticMarkup(
      createElement(
        Select,
        {
          defaultOpen: true,
          defaultValue: 'all',
        },
        createElement(SelectTrigger, null, createElement(SelectValue, { placeholder: 'All tasks' })),
        createElement(
          SelectContent,
          {
            portalled: false,
          },
          createElement(SelectItem, { value: 'all' }, 'All tasks'),
        ),
      ),
    );

    expect(html).toContain('background-color:var(--kitto-main-color, #FFFFFF)');
    expect(html).toContain('color:var(--kitto-contrast-color, #0F172A)');
  });

  it('can render inline without a portal so inherited theme variables remain available', () => {
    const themedStyle: ThemedStyle = {
      '--kitto-main-color': '#111827',
      '--kitto-contrast-color': '#F9FAFB',
      backgroundColor: 'var(--kitto-main-color)',
      color: 'var(--kitto-contrast-color)',
    };

    const html = renderToStaticMarkup(
      createElement(
        Select,
        {
          defaultOpen: true,
          defaultValue: 'all',
        },
        createElement(SelectTrigger, null, createElement(SelectValue, { placeholder: 'All tasks' })),
        createElement(
          SelectContent,
          {
            portalled: false,
            style: themedStyle,
          },
          createElement(SelectItem, { value: 'all' }, 'All tasks'),
        ),
      ),
    );

    expect(html).toContain('--kitto-main-color:#111827');
    expect(html).toContain('--kitto-contrast-color:#F9FAFB');
    expect(html).toContain('background-color:var(--kitto-main-color)');
    expect(html).toContain('color:var(--kitto-contrast-color)');
    expect(html).toContain('All tasks');
  });
});
