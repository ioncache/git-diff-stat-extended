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

copyFile(path.join(projectRoot, 'src', 'git-parse.js'), path.join(distDir, 'git-parse.js'));
copyFile(path.join(projectRoot, 'src', 'classify.js'), path.join(distDir, 'classify.js'));
copyFile(path.join(projectRoot, 'src', 'gdsx-lib.js'), path.join(distDir, 'gdsx-lib.js'));
copyFile(path.join(projectRoot, 'src', 'gdsx-cli.js'), path.join(distDir, 'gdsx-cli.js'));

const entrySource = fs.readFileSync(path.join(projectRoot, 'gdsx'), 'utf8');
const entryRewritten = entrySource.replace('./src/gdsx-cli.js', './gdsx-cli.js');
const entryDest = path.join(distDir, 'gdsx.js');
fs.mkdirSync(path.dirname(entryDest), { recursive: true });
fs.writeFileSync(entryDest, entryRewritten, 'utf8');
fs.chmodSync(entryDest, 0o755);
