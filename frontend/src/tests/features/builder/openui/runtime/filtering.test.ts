import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Renderer } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@features/builder/openui/library';

function renderOpenUi(source: string) {
  return renderToStaticMarkup(createElement(Renderer, { library: builderOpenUiLibrary, response: source }));
}

describe('OpenUI built-in filtering', () => {
  it('renders only the rows returned by @Filter(collection, field, operator, value)', () => {
    const html = renderOpenUi(`items = [
  { label: "A", completed: true },
  { label: "B", completed: false }
]
visibleItems = @Filter(items, "completed", "==", true)
rows = @Each(visibleItems, "item", Text(item.label, "body", "start"))
root = AppShell([
  Screen("main", "Items", [Repeater(rows, "No items")])
])`);

    expect(html).toMatch(/>A</);
    expect(html).not.toMatch(/>B</);
    expect(html).not.toContain('No items');
  });
});
