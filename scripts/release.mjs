import { writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { ConventionalChangelog } from 'conventional-changelog';

const version = process.argv[2];
if (!version || !/^(major|minor|patch)$/.test(version)) {
  console.error('Usage: node scripts/release.mjs <major|minor|patch>');
  process.exit(1);
}

execSync(`npm version ${version} --no-git-tag-version`, { stdio: 'inherit' });

const { version: newVersion } = JSON.parse(
  execSync('node -p "JSON.stringify(require(\'./package.json\'))"', {
    encoding: 'utf8',
  }),
);
const tag = `v${newVersion}`;

execSync(`git add package.json package-lock.json`, { stdio: 'inherit' });
execSync(`git commit -m "chore: release ${tag}"`, { stdio: 'inherit' });
execSync(`git tag -a ${tag} -m "${tag}"`, { stdio: 'inherit' });

const notesFile = `.release-notes-${tag}.md`;
const chunks = [];

const changelog = new ConventionalChangelog({ preset: 'conventionalcommits' });

for await (const chunk of changelog.write()) {
  chunks.push(chunk);
}

let notes = chunks.join('');
const firstNewline = notes.indexOf('\n');
if (firstNewline !== -1) {
  notes = notes.slice(firstNewline + 1).trim();
}

if (!notes) {
  notes = 'No notable changes.';
}

writeFileSync(notesFile, notes);

try {
  execSync(`git push origin main --follow-tags`, { stdio: 'inherit' });
  execSync(`gh release create ${tag} --title "${tag}" --notes-file ${notesFile}`, {
    stdio: 'inherit',
  });
  console.log(`\nReleased ${tag}`);
} finally {
  unlinkSync(notesFile);
}
