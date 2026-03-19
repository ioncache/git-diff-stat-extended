import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');

/**
 * Copies a file from source to destination and ensures destination directories exist.
 *
 * @param {string} sourcePath - Absolute source path.
 * @param {string} destinationPath - Absolute destination path.
 */
function copyFile(sourcePath, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
}

copyFile(path.join(projectRoot, 'gdsx-lib.js'), path.join(distDir, 'gdsx-lib.js'));
copyFile(path.join(projectRoot, 'gdsx'), path.join(distDir, 'gdsx.js'));

// Keep the CLI executable after copying to dist.
fs.chmodSync(path.join(distDir, 'gdsx.js'), 0o755);
