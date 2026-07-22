#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEXT_EXTENSIONS = new Set([
  '.css', '.graphql', '.html', '.js', '.jsx', '.md', '.mjs', '.cjs', '.sql',
  '.svg', '.ts', '.tsx', '.txt', '.json', '.jsonl', '.yml', '.yaml', '.toml',
]);
const SELF = 'scripts/check-public-boundary.mjs';

const rules = [
  { name: 'absolute home path', pattern: /(?:\/Users\/|\/home\/[A-Za-z0-9._-]+\/)/ },
  { name: 'private model session URL', pattern: /https?:\/\/claude\.ai\/code\/session_/i },
  { name: 'generated Railway origin', pattern: /https?:\/\/[^\s'"`]+\.up\.railway\.app/i },
  { name: 'embedded Notion database id', pattern: /NOTION[^\n]{0,80}['"][0-9a-f]{32}['"]/i },
];

/** Scan everything that can enter the next commit, including non-ignored
 *  untracked files. CI sees the tracked release boundary; local runs also
 *  catch a leak before `git add`. */
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT })
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
  .filter((rel) => rel !== SELF && TEXT_EXTENSIONS.has(extname(rel)))
  .filter((rel) => existsSync(join(ROOT, rel)));

const findings = [];
for (const rel of files) {
  const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const rule of rules) {
      if (rule.pattern.test(lines[i])) findings.push(`${rel}:${i + 1}: ${rule.name}`);
    }
  }
}

if (findings.length) {
  console.error(findings.join('\n'));
  console.error(`\nFAIL: ${findings.length} public-boundary violation${findings.length === 1 ? '' : 's'}`);
  process.exit(1);
}

console.log(`OK: public boundary clean across ${files.length} tracked or untracked text files`);
