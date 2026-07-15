#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOTS = ['src', 'scripts', '.github'];
const ROOT_FILES = ['package.json', 'package-lock.json', 'railway.json', 'nixpacks.toml'];
const TEXT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.yml', '.yaml', '.toml']);
const SELF = 'scripts/check-public-boundary.mjs';

const rules = [
  { name: 'absolute home path', pattern: /(?:\/Users\/|\/home\/[A-Za-z0-9._-]+\/)/ },
  { name: 'private model session URL', pattern: /https?:\/\/claude\.ai\/code\/session_/i },
  { name: 'generated Railway origin', pattern: /https?:\/\/[^\s'"`]+\.up\.railway\.app/i },
  { name: 'embedded Notion database id', pattern: /NOTION[^\n]{0,80}['"][0-9a-f]{32}['"]/i },
];

function walk(path, out) {
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.isFile()) {
    const rel = relative(ROOT, path);
    if (rel !== SELF && TEXT_EXTENSIONS.has(extname(path))) out.push(path);
    return;
  }
  for (const name of readdirSync(path)) walk(join(path, name), out);
}

const files = [];
for (const root of SCAN_ROOTS) walk(join(ROOT, root), files);
for (const file of ROOT_FILES) walk(join(ROOT, file), files);

const findings = [];
for (const path of files) {
  const rel = relative(ROOT, path);
  const lines = readFileSync(path, 'utf8').split('\n');
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

console.log(`OK: public boundary clean across ${files.length} source/config files`);
