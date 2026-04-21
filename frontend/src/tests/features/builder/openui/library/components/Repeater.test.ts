import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Renderer } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@features/builder/openui/library';

function renderOpenUi(source: string) {
  return renderToStaticMarkup(createElement(Renderer, { library: builderOpenUiLibrary, response: source }));
}

describe('RepeaterComponent', () => {
  it('keeps the empty-state wrapper lightweight without forcing a white surface', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("main", "Main", [
    Repeater([], "Nothing to show yet.")
  ])
])`);

    expect(html).toContain(
      '<div class="flex flex-col gap-3 rounded-xl p-3"><div class="text-sm text-current opacity-80">Nothing to show yet.</div></div>',
    );
  });
});
