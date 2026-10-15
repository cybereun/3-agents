#!/usr/bin/env node
// gemini -p (stdin + 짧은 -p 지시문) 흉내: 첫 줄에 배너가 섞여 나온다
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('0.9.9');
  process.exit(0);
}
const input = readFileSync(0, 'utf8');
if (input.includes('FAIL')) {
  console.error('Please set an Auth method in your settings.json or specify one of the following environment variables');
  process.exit(41);
}
process.stdout.write('Loaded cached credentials.\n');
const text = input.includes('ARGS') ? 'ARGS=' + JSON.stringify(args) : '제미니:' + input.trim();
for (const piece of text.match(/[\s\S]{1,7}/g)) process.stdout.write(piece);
