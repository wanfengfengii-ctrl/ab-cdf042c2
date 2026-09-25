/* 构建检查：校验静态资源完整性 + JS 语法 + 求解器冒烟，然后拷贝到 dist/ */
import { mkdirSync, rmSync, cpSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

const required = ['index.html', 'styles.css', 'app.js', 'solver.js'];
const fail = (msg) => { console.error('✗ ' + msg); process.exitCode = 1; };
const ok = (msg) => console.log('✓ ' + msg);

// 1. 必需文件存在且非空
for (const f of required) {
  const p = join(src, f);
  if (!existsSync(p)) { fail(`缺少文件 src/${f}`); continue; }
  const size = readFileSync(p, 'utf8').trim().length;
  if (size === 0) fail(`文件为空 src/${f}`);
  else ok(`src/${f} (${size} 字符)`);
}
if (process.exitCode) process.exit(1);

// 2. JS 语法检查（在隔离上下文编译，不执行）
for (const f of ['app.js', 'solver.js']) {
  const code = readFileSync(join(src, f), 'utf8');
  try {
    new vm.Script(code, { filename: f });
    ok(`${f} 语法检查通过`);
  } catch (e) {
    fail(`${f} 语法错误: ${e.message}`);
  }
}
if (process.exitCode) process.exit(1);

// 3. HTML 引用的静态资源必须存在
const html = readFileSync(join(src, 'index.html'), 'utf8');
for (const ref of ['styles.css', 'solver.js', 'app.js']) {
  if (html.includes(ref)) ok(`index.html 引用 ${ref}`);
  else fail(`index.html 未引用 ${ref}`);
}
if (process.exitCode) process.exit(1);

// 4. 求解器冒烟：典型用例必须返回最优可行解
const require = createRequire(import.meta.url);
const Solver = require(join(src, 'solver.js'));
const smoke = Solver.solve({
  alerts: [
    { name: 'a', freq: 100, minLen: 1, maxLen: 8 },
    { name: 'b', freq: 50, minLen: 1, maxLen: 8 },
    { name: 'c', freq: 20, minLen: 1, maxLen: 8 },
    { name: 'd', freq: 10, minLen: 1, maxLen: 8 },
    { name: 'e', freq: 5, minLen: 1, maxLen: 8 }
  ],
  reserved: ['111']
});
if (!smoke.ok) fail('求解器冒烟失败：典型用例无解');
else {
  const codes = smoke.assignment.map((a) => a.code);
  const prefixFree = codes.every((c, i) =>
    codes.every((o, j) => i === j || !o.startsWith(c)));
  const dodgeReserved = codes.every((c) => !c.startsWith('111') && !'111'.startsWith(c));
  if (!prefixFree) fail('求解器冒烟失败：码字存在前缀冲突');
  else if (!dodgeReserved) fail('求解器冒烟失败：码字触碰保留前缀');
  else ok(`求解器冒烟通过（成本 ${smoke.cost}，最大码长 ${smoke.maxLen}）`);
}
if (process.exitCode) process.exit(1);

// 5. 输出 dist/
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(src, dist, { recursive: true });
ok(`静态站点已输出到 dist/（${required.join(', ')}）`);
console.log('构建检查全部通过');
