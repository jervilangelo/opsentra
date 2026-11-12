// Starts Vitest with an upper-case drive letter everywhere.
// On Windows, a lowercase drive (c:\ — as VS Code terminals use) makes Vitest
// load its runner twice and every suite fails with "failed to find the runner".
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const upperDrive = (p) =>
  process.platform === 'win32' ? p.replace(/^[a-z]:/, (d) => d.toUpperCase()) : p;

process.chdir(upperDrive(process.cwd()));
const require = createRequire(upperDrive(process.cwd()) + '/');
const bin = upperDrive(require.resolve('vitest/package.json')).replace(
  /package\.json$/,
  'vitest.mjs',
);
await import(pathToFileURL(bin).href);
