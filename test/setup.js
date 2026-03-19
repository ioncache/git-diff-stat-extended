import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach } from 'vitest';

const createdRepos = new Set();

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function writeFile(repo, relativePath, content) {
  const target = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function commitAll(repo, message) {
  run('git', ['add', '-A'], repo);
  run('git', ['commit', '-m', message], repo);
}

function createRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gdsx-test-'));
  run('git', ['init'], repo);
  run('git', ['config', 'user.name', 'gdsx-test'], repo);
  run('git', ['config', 'user.email', 'gdsx-test@example.com'], repo);
  createdRepos.add(repo);
  return repo;
}

afterEach(() => {
  for (const repoPath of createdRepos) {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
  createdRepos.clear();
});

globalThis.gdsxTestUtils = {
  run,
  writeFile,
  commitAll,
  createRepo,
};
