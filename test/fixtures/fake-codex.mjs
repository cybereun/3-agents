#!/usr/bin/env node
// codex exec 흉내: 진행 로그는 stdout/stderr 에 섞고, 최종 답변은 -o 파일에 쓴다
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('codex-cli 9.9.9');
  process.exit(0);
}
const input = readFileSync(0, 'utf8');
const outFile = args[args.indexOf('-o') + 1];
console.error('WARNING: proceeding, even though we could not create PATH aliases');
if (input.includes('FAIL')) {
  console.error('ERROR: unexpected status 401 Unauthorized: Missing bearer or basic authentication');
  process.exit(101);
}
console.log('OpenAI Codex v9.9.9\n--------\nworkdir: /x\n--------');
writeFileSync(outFile, input.includes('ARGS') ? 'ARGS=' + JSON.stringify(args) : '최종:' + input.trim());
