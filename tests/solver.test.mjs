import test from 'node:test';
import assert from 'node:assert/strict';
import Solver from '../src/solver.js';

const A = (name, freq, minLen, maxLen) => ({ name, freq, minLen, maxLen });

/* ---------- 工具 ---------- */

function isPrefix(a, b) { return b.startsWith(a); }

function checkPrefixFree(codes) {
  for (let i = 0; i < codes.length; i++) {
    for (let j = 0; j < codes.length; j++) {
      if (i !== j && isPrefix(codes[i], codes[j])) return false;
    }
  }
  return true;
}

function touchesReserved(code, reserved) {
  return reserved.some((r) => code.startsWith(r) || r.startsWith(code));
}

function checkResultConsistent(model, res) {
  assert.ok(res.ok, '应有解');
  assert.equal(res.assignment.length, model.alerts.length);
  const codes = res.assignment.map((a) => a.code);
  // 每类恰一条、长度落在区间内
  res.assignment.forEach((a, i) => {
    assert.equal(a.length, a.code.length);
    assert.ok(a.length >= model.alerts[i].minLen && a.length <= model.alerts[i].maxLen,
      `第${i + 1}类码长越界`);
    assert.equal(a.contribution, a.freq * a.length);
    assert.ok(/^[01]+$/.test(a.code));
  });
  // 两两不互为前缀
  assert.ok(checkPrefixFree(codes), '码字存在前缀冲突: ' + codes.join(','));
  // 不落入也不遮蔽保留前缀
  codes.forEach((c) => assert.ok(!touchesReserved(c, res.reserved), `码字 ${c} 触碰保留前缀`));
  // 总成本与最大码长
  const cost = res.assignment.reduce((s, a) => s + a.contribution, 0);
  assert.equal(res.cost, cost);
  assert.equal(res.maxLen, Math.max(...res.assignment.map((a) => a.length)));
}

/* 暴力枚举：返回最优 {cost, max, codes} 或 null */
function bruteForce(model) {
  const alerts = model.alerts;
  const reserved = Solver.normalizeReserved(model.reserved.filter((r) => r.length > 0));
  const n = alerts.length;
  let best = null;
  const chosen = [];
  function* codewords(lo, hi) {
    for (let l = lo; l <= hi; l++) {
      for (let x = 0; x < (1 << l); x++) yield x.toString(2).padStart(l, '0');
    }
  }
  const cmpStr = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
  function better(cand, inc) {
    if (cand.cost !== inc.cost) return cand.cost < inc.cost;
    if (cand.max !== inc.max) return cand.max < inc.max;
    for (let i = 0; i < n; i++) {
      const c = cmpStr(cand.codes[i], inc.codes[i]);
      if (c !== 0) return c < 0;
    }
    return false;
  }
  function dfs(i, cost, max) {
    if (i === n) {
      const cand = { cost, max, codes: chosen.slice() };
      if (!best || better(cand, best)) best = cand;
      return;
    }
    // 内部节点：剩余成本为正，spent 已不劣于现任最优时不可能翻盘
    if (best && cost >= best.cost) return;
    for (const c of codewords(alerts[i].minLen, alerts[i].maxLen)) {
      if (touchesReserved(c, reserved)) continue;
      if (chosen.some((o) => isPrefix(o, c) || isPrefix(c, o))) continue;
      chosen.push(c);
      dfs(i + 1, cost + alerts[i].freq * c.length, Math.max(max, c.length));
      chosen.pop();
    }
  }
  dfs(0, 0, 0);
  return best;
}

/* 可复现随机数 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 输入校验 ---------- */

test('校验：警报数量须为 5–8', () => {
  const few = Solver.solve({ alerts: [A('a', 1, 1, 4), A('b', 1, 1, 4), A('c', 1, 1, 4), A('d', 1, 1, 4)], reserved: [] });
  assert.equal(few.ok, false);
  assert.equal(few.kind, 'validation');
  const many = Solver.solve({ alerts: Array.from({ length: 9 }, (_, i) => A('a' + i, 1, 1, 4)), reserved: [] });
  assert.equal(many.kind, 'validation');
});

test('校验：频次须为正整数', () => {
  const base = Array.from({ length: 5 }, (_, i) => A('a' + i, 1, 1, 4));
  base[2] = A('c', 0, 1, 4);
  assert.equal(Solver.solve({ alerts: base, reserved: [] }).kind, 'validation');
  base[2] = A('c', 1.5, 1, 4);
  assert.equal(Solver.solve({ alerts: base, reserved: [] }).kind, 'validation');
  base[2] = A('c', -3, 1, 4);
  assert.equal(Solver.solve({ alerts: base, reserved: [] }).kind, 'validation');
});

test('校验：码长区间须合法', () => {
  const base = Array.from({ length: 5 }, (_, i) => A('a' + i, 1, 1, 4));
  base[1] = A('b', 1, 5, 2); // 下限 > 上限
  assert.equal(Solver.solve({ alerts: base, reserved: [] }).kind, 'validation');
  base[1] = A('b', 1, 0, 2); // 下限 < 1
  assert.equal(Solver.solve({ alerts: base, reserved: [] }).kind, 'validation');
  base[1] = A('b', 1, 1, 99); // 上限过大
  assert.equal(Solver.solve({ alerts: base, reserved: [] }).kind, 'validation');
});

test('校验：保留前缀须为 0/1 且不超过 3 条', () => {
  const alerts = Array.from({ length: 5 }, (_, i) => A('a' + i, 1, 1, 4));
  assert.equal(Solver.solve({ alerts, reserved: ['012'] }).kind, 'validation');
  assert.equal(Solver.solve({ alerts, reserved: ['0', '1', '01', '10'] }).kind, 'validation');
  assert.equal(Solver.solve({ alerts, reserved: [''] }).ok, true); // 空串忽略
});

test('校验：名称为空', () => {
  const alerts = Array.from({ length: 5 }, (_, i) => A('a' + i, 1, 1, 4));
  alerts[3] = A('   ', 1, 1, 4);
  assert.equal(Solver.solve({ alerts, reserved: [] }).kind, 'validation');
});

/* ---------- 保留前缀归一化 ---------- */

test('保留前缀归一化：去重并剔除被覆盖项', () => {
  assert.deepEqual(Solver.normalizeReserved(['010', '01', '11', '11']), ['01', '11']);
  assert.deepEqual(Solver.normalizeReserved([]), []);
  assert.deepEqual(Solver.normalizeReserved(['1', '0']), ['0', '1']);
});

/* ---------- 功能正确性 ---------- */

test('高频警报获得更短码字', () => {
  const model = {
    alerts: [A('高频', 100, 1, 8), A('低1', 1, 1, 8), A('低2', 1, 1, 8), A('低3', 1, 1, 8), A('低4', 1, 1, 8)],
    reserved: []
  };
  const res = Solver.solve(model);
  checkResultConsistent(model, res);
  const hiLen = res.assignment[0].length;
  res.assignment.slice(1).forEach((a) => assert.ok(a.length >= hiLen));
  assert.equal(res.assignment[0].code, '0'); // 最高频应拿字典序最小的最短码
});

test('码字不得落入或遮蔽保留前缀', () => {
  const model = {
    alerts: Array.from({ length: 5 }, (_, i) => A('a' + i, 5 - i, 1, 6)),
    reserved: ['0']
  };
  const res = Solver.solve(model);
  checkResultConsistent(model, res);
  res.assignment.forEach((a) => assert.ok(a.code.startsWith('1'), '码字必须落在 1 子树'));
});

test('保留前缀遮蔽全部码空间时无解', () => {
  const model = {
    alerts: Array.from({ length: 5 }, (_, i) => A('a' + i, 1, 1, 6)),
    reserved: ['0', '1']
  };
  const res = Solver.solve(model);
  assert.equal(res.ok, false);
  assert.equal(res.kind, 'infeasible');
  assert.ok(res.reason.includes('没有可用的完整分配'));
});

test('码空间不足时无解', () => {
  const model = {
    alerts: Array.from({ length: 5 }, (_, i) => A('a' + i, 1, 1, 1)), // 5 类都要 1 bit，只有 2 个位置
    reserved: []
  };
  const res = Solver.solve(model);
  assert.equal(res.ok, false);
  assert.equal(res.kind, 'infeasible');
});

test('码长区间强制下限生效', () => {
  const model = {
    alerts: Array.from({ length: 6 }, (_, i) => A('a' + i, 10 - i, 3, 6)),
    reserved: []
  };
  const res = Solver.solve(model);
  checkResultConsistent(model, res);
  res.assignment.forEach((a) => assert.ok(a.length >= 3));
});

test('字典序 tie-break：对称输入取字典序最小', () => {
  const model = {
    alerts: Array.from({ length: 8 }, (_, i) => A('a' + i, 1, 1, 10)),
    reserved: []
  };
  const res = Solver.solve(model);
  checkResultConsistent(model, res);
  assert.deepEqual(res.assignment.map((a) => a.code),
    ['000', '001', '010', '011', '100', '101', '110', '111']);
});

test('最大码长次优目标：同成本下取更小的最大码长', () => {
  // 5 类等频：成本 12 可用 [2,2,2,3,3]（max 3），优于任何含 1 bit 码字的方案
  const model = {
    alerts: Array.from({ length: 5 }, (_, i) => A('a' + i, 1, 1, 8)),
    reserved: []
  };
  const res = Solver.solve(model);
  checkResultConsistent(model, res);
  assert.equal(res.cost, 12);
  assert.equal(res.maxLen, 3);
});

test('嵌套保留前缀自动归并后求解', () => {
  const model = {
    alerts: Array.from({ length: 5 }, (_, i) => A('a' + i, i + 1, 1, 6)),
    reserved: ['010', '01'] // '010' 被 '01' 覆盖
  };
  const res = Solver.solve(model);
  checkResultConsistent(model, res);
  assert.deepEqual(res.reserved, ['01']);
});

/* ---------- 与暴力枚举对拍 ---------- */

test('随机小案例与暴力枚举完全一致', () => {
  const rand = mulberry32(20260925);
  const ri = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  let solved = 0, infeasible = 0;
  for (let iter = 0; iter < 80; iter++) {
    const n = ri(5, 6);
    const alerts = [];
    for (let i = 0; i < n; i++) {
      alerts.push(A('a' + i, ri(1, 6), 1, ri(3, 4)));
    }
    const reserved = [];
    const rCount = ri(0, 1);
    for (let i = 0; i < rCount; i++) {
      reserved.push(Array.from({ length: ri(2, 3) }, () => (rand() < 0.5 ? '0' : '1')).join(''));
    }
    const model = { alerts, reserved };
    const res = Solver.solve(model);
    const brute = bruteForce(model);
    if (!brute) {
      assert.equal(res.ok, false, `案例 ${iter} 暴力无解但求解器有解: ${JSON.stringify(model)}`);
      infeasible++;
      continue;
    }
    assert.ok(res.ok, `案例 ${iter} 暴力有解但求解器无解: ${JSON.stringify(model)}`);
    assert.equal(res.cost, brute.cost, `案例 ${iter} 成本不一致: ${JSON.stringify(model)}`);
    assert.equal(res.maxLen, brute.max, `案例 ${iter} 最大码长不一致: ${JSON.stringify(model)}`);
    assert.deepEqual(res.assignment.map((a) => a.code), brute.codes,
      `案例 ${iter} 字典序最小方案不一致: ${JSON.stringify(model)}`);
    checkResultConsistent(model, res);
    solved++;
  }
  assert.ok(solved > 30, `有效可解案例过少: ${solved}`);
  console.log(`    （对拍统计：${solved} 个可解，${infeasible} 个无解，共 80 例）`);
});

test('较大随机案例的结果均满足全部约束', () => {
  const rand = mulberry32(1234567);
  const ri = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  for (let iter = 0; iter < 60; iter++) {
    const n = ri(5, 8);
    const alerts = [];
    for (let i = 0; i < n; i++) {
      const lo = ri(1, 4);
      alerts.push(A('a' + i, ri(1, 500), lo, lo + ri(2, 10)));
    }
    const reserved = [];
    const rCount = ri(0, 3);
    for (let i = 0; i < rCount; i++) {
      reserved.push(Array.from({ length: ri(1, 8) }, () => (rand() < 0.5 ? '0' : '1')).join(''));
    }
    const model = { alerts, reserved };
    const res = Solver.solve(model);
    if (res.ok) checkResultConsistent(model, res);
    else assert.equal(res.kind, 'infeasible');
  }
});

/* ---------- 性能保障 ---------- */

test('最坏情况在限时内完成', () => {
  const cases = [
    { alerts: Array.from({ length: 8 }, (_, i) => A('a' + i, 1, 1, 24)), reserved: [] },
    { alerts: Array.from({ length: 8 }, (_, i) => A('a' + i, 1000 - i * 100, 1, 24)), reserved: [] },
    { alerts: Array.from({ length: 8 }, (_, i) => A('a' + i, 7, 1, 24)), reserved: ['00000000000000000000000000000001', '1111111111111111', '010101010101'] },
    { alerts: Array.from({ length: 8 }, (_, i) => A('a' + i, 3, 16, 24)), reserved: [] },
    { alerts: Array.from({ length: 8 }, (_, i) => A('a' + i, 1000000000 - i, 1, 24)), reserved: ['01'] },
    { alerts: Array.from({ length: 8 }, (_, i) => A('a' + i, i + 1, 1, 2)), reserved: ['0'] }
  ];
  for (const [idx, model] of cases.entries()) {
    const t0 = Date.now();
    const res = Solver.solve(model);
    const ms = Date.now() - t0;
    assert.ok(ms < 5000, `案例 ${idx} 耗时 ${ms}ms 超限`);
    if (res.ok) checkResultConsistent(model, res);
  }
});
