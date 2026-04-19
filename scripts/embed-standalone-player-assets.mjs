import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, '..');
const standalonePlayerDirectory = path.resolve(repositoryRoot, 'frontend/dist-standalone-player');
const standalonePlayerJsPath = path.resolve(standalonePlayerDirectory, 'player.js');
const standalonePlayerCssPath = path.resolve(standalonePlayerDirectory, 'style.css');
const generatedModulePath = path.resolve(
  repositoryRoot,
  'frontend/src/features/builder/standalone/playerAssets.generated.ts',
);
const watchMode = process.argv.includes('--watch');

function readRequiredFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing standalone player ${label}: ${path.relative(repositoryRoot, filePath)}`);
  }

  return fs.readFileSync(filePath, 'utf8');
}

function createGeneratedSource(standalonePlayerJs, standalonePlayerCss) {
  return `// Generated file. Do not edit manually.
export const STANDALONE_PLAYER_JS = ${JSON.stringify(standalonePlayerJs)};
export const STANDALONE_PLAYER_CSS = ${JSON.stringify(standalonePlayerCss)};
`;
}

function writeGeneratedModule({ allowMissing = false } = {}) {
  if (!fs.existsSync(standalonePlayerJsPath) || !fs.existsSync(standalonePlayerCssPath)) {
    if (allowMissing) {
      return false;
    }

    if (!fs.existsSync(standalonePlayerJsPath)) {
      throw new Error(`Missing standalone player JavaScript bundle: ${path.relative(repositoryRoot, standalonePlayerJsPath)}`);
    }

    throw new Error(`Missing standalone player CSS bundle: ${path.relative(repositoryRoot, standalonePlayerCssPath)}`);
  }

  const standalonePlayerJs = readRequiredFile(standalonePlayerJsPath, 'JavaScript bundle');
  const standalonePlayerCss = readRequiredFile(standalonePlayerCssPath, 'CSS bundle');
  const generatedSource = createGeneratedSource(standalonePlayerJs, standalonePlayerCss);

  fs.mkdirSync(path.dirname(generatedModulePath), { recursive: true });

  const currentGeneratedSource = fs.existsSync(generatedModulePath) ? fs.readFileSync(generatedModulePath, 'utf8') : null;

  if (currentGeneratedSource === generatedSource) {
    return false;
  }

  fs.writeFileSync(generatedModulePath, generatedSource, 'utf8');
  console.log(`[standalone] embedded assets -> ${path.relative(repositoryRoot, generatedModulePath)}`);
  return true;
}

function getBundleSignature() {
  if (!fs.existsSync(standalonePlayerJsPath) || !fs.existsSync(standalonePlayerCssPath)) {
    return 'missing';
  }

  const jsStats = fs.statSync(standalonePlayerJsPath);
  const cssStats = fs.statSync(standalonePlayerCssPath);

  return `${jsStats.size}:${jsStats.mtimeMs}|${cssStats.size}:${cssStats.mtimeMs}`;
}

function watchGeneratedModule() {
  fs.mkdirSync(standalonePlayerDirectory, { recursive: true });

  let debounceTimer = null;
  let lastBundleSignature = null;

  function scheduleWrite() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;

      try {
        writeGeneratedModule({ allowMissing: true });
      } catch (error) {
        console.error(
          `[standalone] failed to embed standalone assets: ${error instanceof Error ? error.message : 'Unknown error.'}`,
        );
      }
    }, 75);
  }

  const pollIntervalId = setInterval(() => {
    const nextBundleSignature = getBundleSignature();

    if (nextBundleSignature === lastBundleSignature) {
      return;
    }

    lastBundleSignature = nextBundleSignature;
    scheduleWrite();
  }, 250);

  function shutdown(signal) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    clearInterval(pollIntervalId);

    if (signal) {
      process.exit(0);
    }
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.log(`[standalone] watching ${path.relative(repositoryRoot, standalonePlayerDirectory)} for rebuilds`);
  lastBundleSignature = getBundleSignature();
  scheduleWrite();
}

if (watchMode) {
  watchGeneratedModule();
} else {
  writeGeneratedModule();
}
