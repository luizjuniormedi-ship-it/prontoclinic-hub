#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const file = process.argv[2] || 'test-results/results.json';
const report = JSON.parse(await readFile(file, 'utf8'));
const critical = [];

function visit(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;

  if (String(value.impact || '').toLowerCase() === 'critical') {
    critical.push({ path, id: value.id || value.rule || 'unknown', message: value.message || value.help || '' });
  }
  for (const [key, child] of Object.entries(value)) {
    visit(child, `${path}.${key}`);
  }
}

visit(report);

if (critical.length > 0) {
  console.error('Critical accessibility violations reported by Playwright:');
  for (const item of critical) {
    console.error(`- ${item.id} at ${item.path}${item.message ? `: ${item.message}` : ''}`);
  }
  process.exit(1);
}

console.log('No critical accessibility violations were reported by the executed tests.');
