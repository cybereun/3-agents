#!/usr/bin/env node
// claude CLI 의 stream-json 출력 형식을 흉내 내는 테스트용 가짜 (실제 출력에서 관찰한 이벤트 구성)
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('9.9.9 (Fake Claude)');
  process.exit(0);
}
const input = readFileSync(0, 'utf8');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
out({ type: 'active_goal', value: null });
out({ type: 'system', subtype: 'init', tools: [], model: args.includes('--model') ? 'actual-' + args[args.indexOf('--model') + 1] : 'claude-default-x' });

if (input.includes('NOT_LOGGED_IN')) {
  out({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' });
  process.exit(1);
}
if (input.includes('HANG')) {
  setInterval(() => {}, 1000);
} else {
  const text = input.includes('ARGS')
    ? 'ARGS=' + JSON.stringify(args)
    : input.includes('ENV')
      ? 'ENV=' + (process.env.ANTHROPIC_API_KEY ?? 'unset')
      : '응답:' + input.trim();
  out({ type: 'stream_event', event: { type: 'message_start' } });
  for (const piece of text.match(/[\s\S]{1,5}/g)) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: piece } } });
  }
  out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: text });
}
