#!/usr/bin/env node
// agy(Antigravity CLI) 흉내: -p <프롬프트> 를 인자로 받고 --output-format text 로 stdout 에 답한다.
// BsideBrowser 에서 확인한 호출 형태(-p, --output-format, --model, --effort, --disable-slash-commands)를 따른다.
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('agy 9.9.9');
  process.exit(0);
}
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const prompt = flag('-p') ?? '';
if (prompt.includes('NOT_LOGGED_IN')) {
  console.error('Error: authentication required. Run `agy` to log in.');
  process.exit(1);
}
if (prompt.includes('HANG')) {
  setInterval(() => {}, 1000);
} else {
  // 인자 전달이 변조 없이 이뤄졌는지 확인할 수 있게 그대로 되돌려 준다
  if (prompt.includes('ECHO_ARGS')) process.stdout.write('ARGS=' + JSON.stringify(args));
  else process.stdout.write('아그: ' + prompt.split('[요청]\n').pop());
}
