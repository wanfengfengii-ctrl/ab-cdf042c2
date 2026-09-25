import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------- 极简 DOM 桩：仅实现 app.js 用到的 API ---------------- */

function makeClassList() {
  const set = new Set();
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
    toString: () => [...set].join(' ')
  };
}

function makeNode(tagName) {
  const node = {
    tagName: String(tagName).toUpperCase(),
    children: [],
    childNodes: [],
    parentNode: null,
    attributes: {},
    listeners: {},
    classList: makeClassList(),
    style: {},
    value: '',
    hidden: false,
    disabled: false,
    _text: '',
    _class: '',
    get firstChild() { return node.children[0] || null; },
    get className() { return node._class; },
    set className(v) { node._class = v; },
    get textContent() {
      if (node.children.length === 0) return node._text;
      return node.children.map((c) => c.textContent).join('');
    },
    set textContent(v) {
      node.children.length = 0;
      node.childNodes = node.children;
      node._text = String(v);
    },
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);
      node.childNodes = node.children;
      return child;
    },
    removeChild(child) {
      const i = node.children.indexOf(child);
      if (i >= 0) node.children.splice(i, 1);
      node.childNodes = node.children;
      return child;
    },
    setAttribute(k, v) { node.attributes[k] = String(v); },
    getAttribute(k) { return node.attributes[k]; },
    addEventListener(type, fn) { (node.listeners[type] ||= []).push(fn); },
    dispatch(type, extra) {
      const evt = Object.assign({ type, target: node }, extra || {});
      (node.listeners[type] || []).slice().forEach((fn) => fn(evt));
    },
    click() { node.dispatch('click'); }
  };
  return node;
}

function walkAll(node, out = []) {
  out.push(node);
  node.children.forEach((c) => walkAll(c, out));
  return out;
}

function makeDocument() {
  const ids = [
    'alertsTbody', 'alertsCountHint', 'btnAddAlert', 'reservedWrap', 'btnGenerate',
    'btnSample', 'btnClear', 'errorBanner', 'resultPlaceholder', 'resultBody',
    'resultStatus', 'sumCost', 'sumMax', 'sumReserved', 'treeWrap', 'detailTbody',
    'detailTotal', 'reservedDetail', 'draftState'
  ];
  const byId = {};
  ids.forEach((id) => { byId[id] = makeNode('div'); });
  byId.errorBanner.hidden = true;
  byId.resultBody.hidden = true;
  return {
    _byId: byId,
    getElementById: (id) => byId[id] || null,
    createElement: (tag) => makeNode(tag),
    createElementNS: (ns, tag) => makeNode(tag),
    createTextNode: (t) => {
      const n = makeNode('#text');
      n._text = String(t);
      return n;
    }
  };
}

function makeLocalStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    _data: data
  };
}

/** 在桩 DOM 中启动 app.js，返回操控句柄 */
function bootApp(seedDraft) {
  const document = makeDocument();
  const localStorage = makeLocalStorage();
  if (seedDraft) {
    localStorage.setItem('quake-code-workbench:draft:v1', JSON.stringify(seedDraft));
  }
  const sandbox = {
    document,
    localStorage,
    console,
    module: { exports: {} }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  const solverCode = readFileSync(join(rootDir, 'src', 'solver.js'), 'utf8');
  const appCode = readFileSync(join(rootDir, 'src', 'app.js'), 'utf8');
  new vm.Script(solverCode, { filename: 'solver.js' }).runInContext(sandbox);
  sandbox.CodeSolver = sandbox.module.exports;
  // app.js 通过全局引用 CodeSolver（浏览器中来自 <script> 顺序加载）
  new vm.Script('var CodeSolver = module.exports;', { filename: 'bridge.js' }).runInContext(sandbox);
  new vm.Script(appCode, { filename: 'app.js' }).runInContext(sandbox);

  const el = document._byId;
  const alertRows = () => el.alertsTbody.children.map((tr) => {
    const inputs = walkAll(tr).filter((n) => n.tagName === 'INPUT');
    return {
      name: inputs[0], freq: inputs[1], minLen: inputs[2], maxLen: inputs[3],
      del: walkAll(tr).find((n) => n.tagName === 'BUTTON')
    };
  });
  const reservedInputs = () =>
    walkAll(el.reservedWrap).filter((n) => n.tagName === 'INPUT');
  const setInput = (node, value) => {
    node.value = String(value);
    node.dispatch('input', { target: node });
  };
  return { document, localStorage, el, alertRows, reservedInputs, setInput };
}

const VALID_DRAFT = {
  alerts: [
    { name: '特大地震预警', freq: '100', minLen: '1', maxLen: '8' },
    { name: '强余震警报', freq: '50', minLen: '1', maxLen: '8' },
    { name: '烈度速报', freq: '20', minLen: '1', maxLen: '8' },
    { name: '滑坡次生灾害', freq: '10', minLen: '1', maxLen: '8' },
    { name: '海啸联动警报', freq: '5', minLen: '1', maxLen: '8' }
  ],
  reserved: ['111', '', '']
};

/* ---------------- 测试 ---------------- */

test('启动：渲染 5 类输入行与 3 个保留前缀槽，结果区为空', () => {
  const app = bootApp();
  assert.equal(app.alertRows().length, 5);
  assert.equal(app.reservedInputs().length, 3);
  assert.equal(app.el.resultBody.hidden, true);
  assert.equal(app.el.resultPlaceholder.hidden, false);
  assert.match(app.el.resultPlaceholder.textContent, /生成码表/);
});

test('生成码表：汇总、明细、码树、保留分支全部渲染', () => {
  const app = bootApp(VALID_DRAFT);
  app.el.btnGenerate.click();
  assert.equal(app.el.resultBody.hidden, false);
  assert.equal(app.el.resultStatus.textContent, '已生成最优码表');
  // 汇总
  assert.match(app.el.sumCost.textContent, /\d/);
  assert.match(app.el.sumMax.textContent, /bit/);
  // 明细 5 行 + 总成本
  assert.equal(app.el.detailTbody.children.length, 5);
  assert.match(app.el.detailTotal.textContent, /\d/);
  // 码字 pill 出现在明细中
  const pills = walkAll(app.el.detailTbody).filter((n) => n._class === 'code-pill');
  assert.equal(pills.length, 5);
  // 码树 SVG 已渲染且包含码字文本
  const svgTexts = walkAll(app.el.treeWrap).filter((n) => n.tagName === 'TEXT');
  assert.ok(svgTexts.length > 0);
  // 保留分支行
  assert.equal(app.el.reservedDetail.children.length, 1);
  assert.match(app.el.reservedDetail.textContent, /111/);
});

test('输入变动后旧结论立即作废', () => {
  const app = bootApp(VALID_DRAFT);
  app.el.btnGenerate.click();
  assert.equal(app.el.resultBody.hidden, false);
  // 修改任意输入 → 结果区必须清空
  app.setInput(app.alertRows()[0].freq, '999');
  assert.equal(app.el.resultBody.hidden, true, '输入变动后不得保留旧结论');
  assert.equal(app.el.resultPlaceholder.hidden, false);
  assert.match(app.el.resultPlaceholder.textContent, /作废/);
  // 重新生成后恢复
  app.el.btnGenerate.click();
  assert.equal(app.el.resultBody.hidden, false);
});

test('校验失败：显示错误列表且不渲染结果', () => {
  const bad = JSON.parse(JSON.stringify(VALID_DRAFT));
  bad.alerts[2].freq = '0';      // 非正整数
  bad.alerts[3].minLen = '9';    // 下限 > 上限
  bad.alerts[3].maxLen = '4';
  const app = bootApp(bad);
  app.el.btnGenerate.click();
  assert.equal(app.el.resultBody.hidden, true);
  assert.equal(app.el.errorBanner.hidden, false);
  assert.match(app.el.errorBanner.textContent, /正整数/);
  assert.match(app.el.errorBanner.textContent, /码长区间/);
});

test('无解：说明没有可用的完整分配', () => {
  const impossible = {
    alerts: [1, 2, 3, 4, 5].map((i) => ({ name: 'a' + i, freq: '1', minLen: '1', maxLen: '1' })),
    reserved: ['', '', '']
  };
  const app = bootApp(impossible);
  app.el.btnGenerate.click();
  assert.equal(app.el.resultBody.hidden, true);
  assert.equal(app.el.errorBanner.hidden, false);
  assert.match(app.el.errorBanner.textContent, /没有可用的完整分配/);
  assert.equal(app.el.resultStatus.textContent, '无可用完整分配');
});

test('草稿持久化：输入写入 localStorage，重启后恢复', () => {
  const app = bootApp(VALID_DRAFT);
  app.setInput(app.alertRows()[0].name, '改过的名称');
  const saved = JSON.parse(app.localStorage.getItem('quake-code-workbench:draft:v1'));
  assert.equal(saved.alerts[0].name, '改过的名称');
  // 模拟刷新：同一 localStorage 重新启动
  const app2 = (function () {
    const document = makeDocument();
    const sandbox = {
      document,
      localStorage: app.localStorage,
      console,
      module: { exports: {} }
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    new vm.Script(readFileSync(join(rootDir, 'src', 'solver.js'), 'utf8')).runInContext(sandbox);
    new vm.Script('var CodeSolver = module.exports;').runInContext(sandbox);
    new vm.Script(readFileSync(join(rootDir, 'src', 'app.js'), 'utf8')).runInContext(sandbox);
    return { document };
  })();
  const firstRowInputs = walkAll(app2.document._byId.alertsTbody.children[0])
    .filter((n) => n.tagName === 'INPUT');
  assert.equal(firstRowInputs[0].value, '改过的名称');
});

test('增删警报类型：行数受 5–8 限制', () => {
  const app = bootApp(VALID_DRAFT);
  assert.equal(app.alertRows().length, 5);
  app.alertRows()[4].del.click(); // 5 → 不可再删
  assert.equal(app.alertRows().length, 5);
  for (let i = 0; i < 4; i++) app.el.btnAddAlert.click();
  assert.equal(app.alertRows().length, 8);
  assert.equal(app.el.btnAddAlert.disabled, true);
  app.el.btnAddAlert.click(); // 已达上限，无效
  assert.equal(app.alertRows().length, 8);
  app.alertRows()[7].del.click();
  assert.equal(app.alertRows().length, 7);
});

test('载入示例后可直接生成最优码表', () => {
  const app = bootApp();
  app.el.btnSample.click();
  app.el.btnGenerate.click();
  assert.equal(app.el.resultBody.hidden, false);
  assert.equal(app.el.detailTbody.children.length, 6);
  // 示例中最高频的「破坏性地震」应拿到最短码
  const firstPill = walkAll(app.el.detailTbody.children[0])
    .find((n) => n._class === 'code-pill');
  assert.ok(firstPill.textContent.length <= 2);
});
