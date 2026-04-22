import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, '..');
const componentSpecPath = path.resolve(repositoryRoot, 'shared/openui-component-spec.json');
const librarySchemaPath = path.resolve(repositoryRoot, 'shared/openui-library-schema.json');
const libraryEntryPath = path.resolve(repositoryRoot, 'frontend/src/features/builder/openui/library/index.tsx');
const frontendTsconfigPath = path.resolve(repositoryRoot, 'frontend/tsconfig.app.json');

async function main() {
  const { builderOpenUiLibrary, getBuilderOpenUiSpec } = await tsImport(pathToFileURL(libraryEntryPath).href, {
    parentURL: import.meta.url,
    tsconfig: frontendTsconfigPath,
  });

  await mkdir(path.dirname(componentSpecPath), { recursive: true });
  await writeFile(componentSpecPath, `${JSON.stringify(getBuilderOpenUiSpec(), null, 2)}\n`, 'utf8');
  await writeFile(librarySchemaPath, `${JSON.stringify(builderOpenUiLibrary.toJSONSchema(), null, 2)}\n`, 'utf8');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
