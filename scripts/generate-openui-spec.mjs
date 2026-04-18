import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, '..');
const componentSpecPath = path.resolve(repositoryRoot, 'shared/openui/component-spec.json');
const libraryEntryPath = path.resolve(repositoryRoot, 'frontend/src/features/builder/openui/library/index.tsx');
const frontendTsconfigPath = path.resolve(repositoryRoot, 'frontend/tsconfig.app.json');

const { builderOpenUiLibrary } = await tsImport(pathToFileURL(libraryEntryPath).href, {
  parentURL: import.meta.url,
  tsconfig: frontendTsconfigPath,
});

fs.mkdirSync(path.dirname(componentSpecPath), { recursive: true });
fs.writeFileSync(componentSpecPath, `${JSON.stringify(builderOpenUiLibrary.toSpec(), null, 2)}\n`, 'utf8');
