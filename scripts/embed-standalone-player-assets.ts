import { existsSync, unwatchFile, watchFile } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STANDALONE_PLAYER_CSS_PUBLIC_PATH,
  STANDALONE_PLAYER_JS_PUBLIC_PATH,
} from '../frontend/src/features/builder/standalone/constants';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, '..');
const standalonePlayerDirectory = path.resolve(repositoryRoot, 'frontend/dist-standalone-player');
const standalonePlayerJsPath = path.resolve(standalonePlayerDirectory, 'player.js');
const standalonePlayerCssPath = path.resolve(standalonePlayerDirectory, 'style.css');
const generatedModulePath = path.resolve(repositoryRoot, 'frontend/src/features/builder/standalone/playerAssets.generated.ts');
const publicDirectory = path.resolve(repositoryRoot, 'frontend/public');
const mirroredStandalonePlayerJsPath = path.resolve(publicDirectory, STANDALONE_PLAYER_JS_PUBLIC_PATH);
const mirroredStandalonePlayerCssPath = path.resolve(publicDirectory, STANDALONE_PLAYER_CSS_PUBLIC_PATH);
const watchMode = process.argv.includes('--watch');
const watchedBundlePaths = [standalonePlayerJsPath, standalonePlayerCssPath] as const;

function getMissingBundleLabel() {
  if (!existsSync(standalonePlayerJsPath)) {
    return 'JavaScript bundle';
  }

  return 'CSS bundle';
}

async function readStandaloneBundle({ allowMissing = false } = {}) {
  if (!existsSync(standalonePlayerJsPath) || !existsSync(standalonePlayerCssPath)) {
    if (allowMissing) {
      return null;
    }

    throw new Error(
      `Missing standalone player ${getMissingBundleLabel()}: ${path.relative(
        repositoryRoot,
        !existsSync(standalonePlayerJsPath) ? standalonePlayerJsPath : standalonePlayerCssPath,
      )}`,
    );
  }

  const [standalonePlayerJs, standalonePlayerCss] = await Promise.all([
    readFile(standalonePlayerJsPath, 'utf8'),
    readFile(standalonePlayerCssPath, 'utf8'),
  ]);

  return {
    standalonePlayerCss,
    standalonePlayerJs,
  };
}

async function mirrorBundleFile(filePath: string, content: string) {
  const currentContent = existsSync(filePath) ? await readFile(filePath, 'utf8') : null;

  if (currentContent === content) {
    return false;
  }

  await writeFile(filePath, content, 'utf8');
  return true;
}

function createGeneratedModuleContent({
  standalonePlayerCss,
  standalonePlayerJs,
}: {
  standalonePlayerCss: string;
  standalonePlayerJs: string;
}) {
  return `// Generated file. Do not edit manually.
export const STANDALONE_PLAYER_JS = ${JSON.stringify(standalonePlayerJs)};
export const STANDALONE_PLAYER_CSS = ${JSON.stringify(standalonePlayerCss)};
`;
}

async function writeMirroredAssets({ allowMissing = false } = {}) {
  const bundle = await readStandaloneBundle({ allowMissing });

  if (!bundle) {
    return false;
  }

  await mkdir(publicDirectory, { recursive: true });

  const [didUpdateJs, didUpdateCss, didUpdateGeneratedModule] = await Promise.all([
    mirrorBundleFile(mirroredStandalonePlayerJsPath, bundle.standalonePlayerJs),
    mirrorBundleFile(mirroredStandalonePlayerCssPath, bundle.standalonePlayerCss),
    mirrorBundleFile(generatedModulePath, createGeneratedModuleContent(bundle)),
  ]);

  if (!didUpdateJs && !didUpdateCss && !didUpdateGeneratedModule) {
    return false;
  }

  console.log(
    `[standalone] updated standalone assets -> ${path.relative(repositoryRoot, mirroredStandalonePlayerJsPath)}, ${path.relative(repositoryRoot, mirroredStandalonePlayerCssPath)}, ${path.relative(repositoryRoot, generatedModulePath)}`,
  );
  return true;
}

function watchGeneratedModule() {
  void mkdir(standalonePlayerDirectory, { recursive: true });

  let debounceTimer: NodeJS.Timeout | null = null;

  const scheduleWrite = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;

      void writeMirroredAssets({ allowMissing: true }).catch((error) => {
        console.error(
          `[standalone] failed to mirror standalone assets: ${error instanceof Error ? error.message : 'Unknown error.'}`,
        );
      });
    }, 75);
  };

  for (const bundlePath of watchedBundlePaths) {
    watchFile(bundlePath, { interval: 250 }, scheduleWrite);
  }

  const shutdown = (signal?: NodeJS.Signals) => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    for (const bundlePath of watchedBundlePaths) {
      unwatchFile(bundlePath, scheduleWrite);
    }

    if (signal) {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.log(`[standalone] watching ${path.relative(repositoryRoot, standalonePlayerDirectory)} for rebuilds`);
  scheduleWrite();
}

async function main() {
  if (watchMode) {
    watchGeneratedModule();
    return;
  }

  await writeMirroredAssets();
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
