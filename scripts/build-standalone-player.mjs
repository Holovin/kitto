import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, '..');
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

execFileSync(npmExecutable, ['run', 'build:standalone-player', '--workspace', 'frontend'], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});
execFileSync(process.execPath, ['scripts/embed-standalone-player-assets.mjs'], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});
