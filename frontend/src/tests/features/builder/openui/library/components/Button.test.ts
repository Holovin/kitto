import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Renderer } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@features/builder/openui/library';

function renderOpenUi(source: string) {
  return renderToStaticMarkup(createElement(Renderer, { library: builderOpenUiLibrary, response: source }));
}

describe('ButtonComponent', () => {
  it('renders OpenUI buttons with border chrome and without shadows', () => {
    const html = renderOpenUi(`root = AppShell([
  Screen("main", "Main", [
    Button("save", "Save", "default"),
    Button("cancel", "Cancel", "secondary"),
    Button("delete", "Delete", "destructive")
  ])
])`);

    expect(html).toMatch(
      /<button[^>]+class="(?=[^"]*bg-slate-950)(?=[^"]*border)(?=[^"]*border-slate-200)(?=[^"]*!shadow-none)(?=[^"]*hover:!shadow-none)[^"]*"[^>]*><span>Save<\/span><\/button>/i,
    );
    expect(html).toMatch(
      /<button[^>]+class="(?=[^"]*bg-white\/70)(?=[^"]*border)(?=[^"]*border-slate-200)(?=[^"]*!ring-0)(?=[^"]*!shadow-none)[^"]*"[^>]*><span>Cancel<\/span><\/button>/i,
    );
    expect(html).toMatch(
      /<button[^>]+class="(?=[^"]*bg-rose-600)(?=[^"]*border)(?=[^"]*border-slate-200)(?=[^"]*!shadow-none)(?=[^"]*hover:!shadow-none)[^"]*"[^>]*><span>Delete<\/span><\/button>/i,
    );
    expect(html).toContain('text-white');
    expect(html).toContain('text-slate-900');
    expect(html).not.toContain('!text-white');
    expect(html).not.toContain('!text-slate-900');
  });
});
