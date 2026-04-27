/// <reference types="node" />

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const chatPanelSourcePath = path.resolve(currentDirectory, '../../../../../pages/Chat/builder/components/ChatPanel.tsx');
const previewTabsSourcePath = path.resolve(currentDirectory, '../../../../../pages/Chat/builder/components/PreviewTabs.tsx');

function readSource(filePath: string) {
  return fs.readFileSync(filePath, 'utf8');
}

describe('builder form attributes', () => {
  it('keeps id, name, and autocomplete on the composer textarea', () => {
    const source = readSource(chatPanelSourcePath);

    expect(source).toContain('autoComplete="off"');
    expect(source).toContain('id="builder-prompt"');
    expect(source).toContain('name="builder-prompt"');
  });

  it('keeps id and name on the import file input', () => {
    const source = readSource(previewTabsSourcePath);

    expect(source).toContain('id="builder-import-json"');
    expect(source).toContain('name="builder-import-json"');
  });
});
