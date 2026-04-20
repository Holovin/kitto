import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from '@components/ui/button';

describe('Button', () => {
  it('keeps the disabled not-allowed cursor without removing pointer events', () => {
    const html = renderToStaticMarkup(createElement(Button, { disabled: true }, 'Save'));

    expect(html).toContain('disabled=""');
    expect(html).toContain('disabled:cursor-not-allowed');
    expect(html).not.toContain('disabled:pointer-events-none');
  });
});
