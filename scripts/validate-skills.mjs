#!/usr/bin/env node
// ARMADA skill validator — the "test suite" for a skills repo.
//
// A feature in ARMADA is a skill. This checks every skills/<name>/SKILL.md has
// well-formed frontmatter: a YAML block delimited by `---`, a `name` that matches
// the directory, and a non-empty `description`. Exits non-zero on any failure so it
// works as shipwright's build/test gate.
//
// Run: node scripts/validate-skills.mjs

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import path from 'path';

const SKILLS_DIR = path.join(process.cwd(), 'skills');

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = text.slice(3, end);
  const fields = {};
  let currentKey = null;
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m && !line.startsWith(' ')) {
      currentKey = m[1];
      fields[currentKey] = m[2].trim();
    } else if (currentKey && (line.startsWith(' ') || line.trim() === '')) {
      // folded/continued value (e.g. `description: >`)
      fields[currentKey] = (fields[currentKey] + ' ' + line.trim()).trim();
    }
  }
  return fields;
}

const errors = [];
let checked = 0;

if (!existsSync(SKILLS_DIR)) {
  console.error(`No skills/ directory at ${SKILLS_DIR}`);
  process.exit(1);
}

for (const entry of readdirSync(SKILLS_DIR)) {
  const dir = path.join(SKILLS_DIR, entry);
  if (!statSync(dir).isDirectory()) continue;
  const skillPath = path.join(dir, 'SKILL.md');

  if (!existsSync(skillPath)) {
    errors.push(`${entry}: missing SKILL.md`);
    continue;
  }
  checked++;
  const fm = parseFrontmatter(readFileSync(skillPath, 'utf8'));
  if (!fm) {
    errors.push(`${entry}: SKILL.md has no YAML frontmatter (--- block)`);
    continue;
  }
  if (!fm.name) errors.push(`${entry}: frontmatter missing 'name'`);
  else if (fm.name !== entry) errors.push(`${entry}: name '${fm.name}' does not match directory '${entry}'`);
  if (!fm.description || fm.description.replace(/[>|]/g, '').trim().length < 20) {
    errors.push(`${entry}: frontmatter 'description' is missing or too short (needs trigger guidance)`);
  }
}

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s) across ${checked} skill(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`✓ ${checked} skill(s) valid.`);
