import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Renderer } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@pages/Chat/builder/openui/library';

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

  it('supports numeric comparison operators such as >=', () => {
    const html = renderOpenUi(`items = [
  { label: "A", score: 75 },
  { label: "B", score: 90 }
]
visibleItems = @Filter(items, "score", ">=", 80)
rows = @Each(visibleItems, "item", Text(item.label, "body", "start"))
root = AppShell([
  Screen("main", "Items", [Repeater(rows, "No items")])
])`);

    expect(html).not.toMatch(/>A</);
    expect(html).toMatch(/>B</);
    expect(html).not.toContain('No items');
  });

  it('supports substring filtering via the contains operator', () => {
    const html = renderOpenUi(`items = [
  { label: "Ship docs" },
  { label: "Write tests" }
]
visibleItems = @Filter(items, "label", "contains", "Ship")
rows = @Each(visibleItems, "item", Text(item.label, "body", "start"))
root = AppShell([
  Screen("main", "Items", [Repeater(rows, "No items")])
])`);

    expect(html).toMatch(/>Ship docs</);
    expect(html).not.toMatch(/>Write tests</);
    expect(html).not.toContain('No items');
  });
});
