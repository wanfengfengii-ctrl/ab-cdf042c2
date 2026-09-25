/*
 * 地震预警短二进制码编配求解器
 *
 * 为每类警报选择恰一条码字，满足：
 *   1. 码字长度落在该类允许的码长闭区间内；
 *   2. 码字两两不互为前缀（任何连续电文都能被唯一拆分）；
 *   3. 码字不落入、也不遮蔽任何保留前缀所代表的区间；
 * 方案取舍顺序：加权码长总和最小 → 最大码长最小 → 按警报输入顺序展开的字典序最小。
 *
 * 算法（n ≤ 8 的小规模精确搜索）：
 *   - 码空间被保留前缀切分为「可用子树森林」；森林只用各子树深度即可精确刻画容量：
 *     把长度 l 的码字放进深度 d 的子树，该子树被替换为深度 d+1..l 的兄弟子树。
 *   - feasible(L, F)：判断长度多重集合 L 能否放进森林 F（记忆化精确判定）。
 *   - 阶段一：对长度向量做分支限界（按频次降序），求最优 (加权总长, 最大码长)。
 *   - 阶段二：按输入顺序逐类贪心取字典序最小、且仍能以最优成本衔接的码字，
 *     可行性由 canPlace（带精确预算的森林判定）保证。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodeSolver = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_ALERTS = 5;
  var MAX_ALERTS = 8;
  var MAX_CODE_LEN = 24;      // 码长闭区间允许的上限
  var MAX_RESERVED = 3;       // 保留前缀最多条数
  var MAX_RESERVED_LEN = 32;  // 保留前缀最大长度
  var MAX_FREQ = 1000000000;  // 预计频次上限（正整数）
  var SCALE = 32;             // 码空间度量单位：整棵树 = 2^32
  var MAX_ENUM_STEPS = 5000000; // 第二阶段枚举的安全步数上限（防御性）

  /* ---------------- 输入处理与校验 ---------------- */

  function cleanReserved(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map(function (r) { return r == null ? '' : String(r).trim(); })
      .filter(function (r) { return r.length > 0; });
  }

  function validate(input) {
    var errors = [];
    if (!input || typeof input !== 'object') return ['输入不能为空'];

    var alerts = Array.isArray(input.alerts) ? input.alerts : [];
    if (alerts.length < MIN_ALERTS || alerts.length > MAX_ALERTS) {
      errors.push('警报类型数量须为 ' + MIN_ALERTS + '–' + MAX_ALERTS + ' 类（当前 ' + alerts.length + ' 类）');
    }
    alerts.forEach(function (a, idx) {
      var tag = '第 ' + (idx + 1) + ' 类';
      var name = a && typeof a.name === 'string' ? a.name.trim() : '';
      if (!name) errors.push(tag + '：警报名称不能为空');
      var freq = Number(a && a.freq);
      if (!Number.isInteger(freq) || freq < 1 || freq > MAX_FREQ) {
        errors.push(tag + '：预计频次须为 1–' + MAX_FREQ + ' 的正整数');
      }
      var lo = Number(a && a.minLen);
      var hi = Number(a && a.maxLen);
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi > MAX_CODE_LEN || lo > hi) {
        errors.push(tag + '：码长区间须满足 1 ≤ 下限 ≤ 上限 ≤ ' + MAX_CODE_LEN);
      }
    });

    var reserved = cleanReserved(input.reserved);
    if (reserved.length > MAX_RESERVED) {
      errors.push('保留前缀最多 ' + MAX_RESERVED + ' 条（当前 ' + reserved.length + ' 条）');
    }
    reserved.forEach(function (r) {
      if (!/^[01]+$/.test(r)) {
        errors.push('保留前缀「' + r + '」只能由 0/1 组成');
      } else if (r.length > MAX_RESERVED_LEN) {
        errors.push('保留前缀「' + r + '」长度不能超过 ' + MAX_RESERVED_LEN + ' bit');
      }
    });
    return errors;
  }

  /* 归一化保留前缀：去重，并剔除被更短保留前缀覆盖的冗余项 */
  function normalizeReserved(list) {
    var sorted = list.slice().sort(function (a, b) {
      return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
    });
    var kept = [];
    sorted.forEach(function (r) {
      var covered = kept.some(function (k) { return r === k || r.indexOf(k) === 0; });
      if (!covered) kept.push(r);
    });
    return kept.sort();
  }

  /* ---------------- 可用码空间：子树森林 ---------------- */

  // 把整棵二叉树扣除保留前缀所代表的子树后，分解为若干极大可用子树。
  function buildForest(reserved) {
    var forest = [];
    (function walk(path) {
      var inside = false;
      var partial = false;
      for (var i = 0; i < reserved.length; i++) {
        var r = reserved[i];
        if (path === r || path.indexOf(r) === 0) { inside = true; break; } // 落在保留子树内
        if (r.indexOf(path) === 0) partial = true;                          // 保留前缀穿过此子树
      }
      if (inside) return;
      if (partial) {
        walk(path + '0');
        walk(path + '1');
      } else {
        forest.push({ path: path, depth: path.length });
      }
    })('');
    forest.sort(function (a, b) { return a.path < b.path ? -1 : 1; });
    return forest;
  }

  function forestMeasure(depths) {
    var m = 0;
    for (var i = 0; i < depths.length; i++) m += Math.pow(2, SCALE - depths[i]);
    return m;
  }

  /* 长度多重集合 lengths（升序数组）能否放入森林 depths（升序数组）——记忆化精确判定 */
  function makeFeasible() {
    var memo = new Map();
    function feasible(lengths, depths) {
      if (lengths.length === 0) return true;
      var key = lengths.join(',') + '|' + depths.join(',');
      if (memo.has(key)) return memo.get(key);

      var ok = false;
      // 必要条件：精确 Kraft 需求不超过可用度量，且最短长度有够浅的子树可放
      var demand = 0;
      for (var i = 0; i < lengths.length; i++) demand += Math.pow(2, SCALE - lengths[i]);
      if (demand <= forestMeasure(depths) && depths[0] <= lengths[0]) {
        var l = lengths[lengths.length - 1]; // 先放最长，分支最少
        var rest = lengths.slice(0, -1);
        var seen = {};
        for (var di = 0; di < depths.length; di++) {
          var d = depths[di];
          if (d > l || seen[d]) continue;
          seen[d] = true;
          var nd = depths.slice();
          nd.splice(di, 1);
          for (var x = d + 1; x <= l; x++) nd.push(x);
          nd.sort(function (a, b) { return a - b; });
          if (feasible(rest, nd)) { ok = true; break; }
        }
      }
      memo.set(key, ok);
      return ok;
    }
    return feasible;
  }

  /* ---------------- 阶段一：长度向量分支限界 ---------------- */

  // 求最优 [加权总长, 最大码长]；不可行返回 null。
  function optimizeLengths(lo, hi, f, depths0) {
    var n = lo.length;
    // 按频次降序搜索（成本界更紧），结果与顺序无关
    var order = [];
    for (var i = 0; i < n; i++) order.push(i);
    order.sort(function (a, b) { return f[b] - f[a] || a - b; });

    var loS = order.map(function (i) { return lo[i]; });
    var hiS = order.map(function (i) { return hi[i]; });
    var fS = order.map(function (i) { return f[i]; });

    var minRest = new Array(n + 1).fill(0);     // 后缀最小成本
    var demandRest = new Array(n + 1).fill(0);  // 后缀最小 Kraft 需求（取最长码长时）
    for (var t = n - 1; t >= 0; t--) {
      minRest[t] = minRest[t + 1] + fS[t] * loS[t];
      demandRest[t] = demandRest[t + 1] + Math.pow(2, SCALE - hiS[t]);
    }

    var feasible = makeFeasible();
    var measure0 = forestMeasure(depths0);
    var chosen = [];
    var best = null; // [cost, max]

    function dfs(i, spent, curMax) {
      if (spent + minRest[i] > (best ? best[0] : Infinity)) return;
      if (best && spent + minRest[i] === best[0] && curMax >= best[1]) return;
      // 必要条件：已选 + 剩余最小需求不能超过总可用度量
      var demand = demandRest[i];
      for (var k = 0; k < i; k++) demand += Math.pow(2, SCALE - chosen[k]);
      if (demand > measure0) return;
      // 精确判定：已选长度必须能放进森林（子集可行是整体可行的必要条件）
      if (i > 0 && !feasible(chosen.slice(0, i).slice().sort(function (a, b) { return a - b; }), depths0)) return;
      if (i === n) {
        if (!best || spent < best[0] || (spent === best[0] && curMax < best[1])) {
          best = [spent, curMax];
        }
        return;
      }
      for (var l = loS[i]; l <= hiS[i]; l++) {
        var c = spent + fS[i] * l;
        if (best && (c + minRest[i + 1] > best[0] ||
            (c + minRest[i + 1] === best[0] && Math.max(curMax, l) >= best[1]))) break;
        chosen[i] = l;
        dfs(i + 1, c, Math.max(curMax, l));
      }
    }
    dfs(0, 0, 0);
    return best;
  }

  /* ---------------- 阶段二：具体码字重构 ---------------- */

  // 判断第 i..n-1 类（输入顺序）能否在森林 depths 中以恰好 budget 的加权成本完成。
  function makeCanPlace(lo, caps, f) {
    var n = lo.length;
    var minRest = new Array(n + 1).fill(0);
    var maxRest = new Array(n + 1).fill(0);
    for (var i = n - 1; i >= 0; i--) {
      minRest[i] = minRest[i + 1] + f[i] * lo[i];
      maxRest[i] = maxRest[i + 1] + f[i] * caps[i];
    }
    var memo = new Map();
    function canPlace(i, depths, budget) {
      if (i === n) return budget === 0;
      if (budget < minRest[i] || budget > maxRest[i]) return false;
      var key = i + '|' + depths.join(',') + '|' + budget;
      if (memo.has(key)) return memo.get(key);
      var ok = false;
      var seen = {};
      for (var l = lo[i]; l <= caps[i] && !ok; l++) {
        var c = f[i] * l;
        if (c + minRest[i + 1] > budget) break;
        if (c + maxRest[i + 1] < budget) continue;
        for (var di = 0; di < depths.length; di++) {
          var d = depths[di];
          if (d > l || seen[l * 64 + d]) continue;
          seen[l * 64 + d] = true;
          var nd = depths.slice();
          nd.splice(di, 1);
          for (var x = d + 1; x <= l; x++) nd.push(x);
          nd.sort(function (a, b) { return a - b; });
          if (canPlace(i + 1, nd, budget - c)) { ok = true; break; }
        }
      }
      memo.set(key, ok);
      return ok;
    }
    return canPlace;
  }

  // 按字典序枚举森林中深度落在 [loL, hiL] 内的全部可用节点。
  function* genCandidates(forest, loL, hiL) {
    for (var s = 0; s < forest.length; s++) {
      yield* walkNode(forest[s].path, forest[s].depth, forest[s].path, loL, hiL);
    }
    function* walkNode(path, depth, subPath, lo, hi) {
      if (depth >= lo && depth <= hi) yield { code: path, subPath: subPath };
      if (depth < hi) {
        yield* walkNode(path + '0', depth + 1, subPath, lo, hi);
        yield* walkNode(path + '1', depth + 1, subPath, lo, hi);
      }
    }
  }

  // 在森林中占用码字 code（位于子树 subPath 内），返回新的有序森林。
  function place(forest, code, subPath) {
    var nf = [];
    for (var i = 0; i < forest.length; i++) {
      if (forest[i].path !== subPath) nf.push(forest[i]);
    }
    var bits = code.slice(subPath.length);
    var p = subPath;
    for (var k = 0; k < bits.length; k++) {
      var sib = p + (bits[k] === '0' ? '1' : '0');
      nf.push({ path: sib, depth: sib.length });
      p += bits[k];
    }
    nf.sort(function (a, b) { return a.path < b.path ? -1 : 1; });
    return nf;
  }

  /* ---------------- 主入口 ---------------- */

  function solve(input) {
    var errors = validate(input);
    if (errors.length) return { ok: false, kind: 'validation', errors: errors };

    var alerts = input.alerts.map(function (a) {
      return {
        name: String(a.name).trim(),
        freq: Number(a.freq),
        minLen: Number(a.minLen),
        maxLen: Number(a.maxLen)
      };
    });
    var n = alerts.length;
    var reserved = normalizeReserved(cleanReserved(input.reserved));
    var forest0 = buildForest(reserved);

    var lo = alerts.map(function (a) { return a.minLen; });
    var hi = alerts.map(function (a) { return a.maxLen; });
    var f = alerts.map(function (a) { return a.freq; });

    var diagnostics = {
      reserved: reserved,
      spaceUnits: forestMeasure(forest0.map(function (s) { return s.depth; })),
      minDemandUnits: alerts.reduce(function (s, a) { return s + Math.pow(2, SCALE - a.maxLen); }, 0),
      maxDemandUnits: alerts.reduce(function (s, a) { return s + Math.pow(2, SCALE - a.minLen); }, 0),
      scale: SCALE
    };

    if (!forest0.length) {
      return {
        ok: false,
        kind: 'infeasible',
        reason: '保留前缀遮蔽了全部码空间，没有可用的完整分配。',
        diagnostics: diagnostics
      };
    }

    // 阶段一：最优 (加权总长, 最大码长)
    var depths0 = forest0.map(function (s) { return s.depth; }).sort(function (a, b) { return a - b; });
    var best = optimizeLengths(lo, hi, f, depths0);
    if (!best) {
      return {
        ok: false,
        kind: 'infeasible',
        reason: '在当前码长区间与保留前缀约束下，没有可用的完整分配（无法满足每类恰一条、两两不互为前缀且不触碰保留分支）。',
        diagnostics: diagnostics
      };
    }
    var total = best[0];
    var maxLen = best[1];

    // 阶段二：在最优解集合中按输入顺序取字典序最小
    var caps = hi.map(function (h) { return Math.min(h, maxLen); });
    var canPlace = makeCanPlace(lo, caps, f);
    var minRest = new Array(n + 1).fill(0);
    var maxRestCap = new Array(n + 1).fill(0);
    for (var i = n - 1; i >= 0; i--) {
      minRest[i] = minRest[i + 1] + f[i] * lo[i];
      maxRestCap[i] = maxRestCap[i + 1] + f[i] * caps[i];
    }

    var forest = forest0.map(function (s) { return { path: s.path, depth: s.depth }; });
    var budget = total;
    var codes = [];
    var steps = 0;

    for (var t = 0; t < n; t++) {
      var chosen = null;
      var iter = genCandidates(forest, lo[t], caps[t]);
      for (var cand = iter.next(); !cand.done; cand = iter.next()) {
        if (++steps > MAX_ENUM_STEPS) throw new Error('码字重构超出安全步数上限');
        var c = cand.value;
        var l = c.code.length;
        var c1 = f[t] * l;
        if (c1 + minRest[t + 1] > budget) continue;    // 剩余类型全取下限也会超支
        if (c1 + maxRestCap[t + 1] < budget) continue; // 剩余类型全取上限也凑不到最优成本
        var nf = place(forest, c.code, c.subPath);
        var nd = nf.map(function (s) { return s.depth; }).sort(function (a, b) { return a - b; });
        if (canPlace(t + 1, nd, budget - c1)) {
          chosen = { code: c.code, forest: nf, cost: c1 };
          break;
        }
      }
      if (!chosen) throw new Error('内部错误：无法重构最优解');
      codes.push(chosen.code);
      forest = chosen.forest;
      budget -= chosen.cost;
    }

    return {
      ok: true,
      cost: total,
      maxLen: maxLen,
      reserved: reserved,
      assignment: alerts.map(function (a, i2) {
        return {
          name: a.name,
          freq: a.freq,
          code: codes[i2],
          length: codes[i2].length,
          contribution: a.freq * codes[i2].length
        };
      })
    };
  }

  return {
    solve: solve,
    validate: validate,
    normalizeReserved: normalizeReserved,
    constants: {
      MIN_ALERTS: MIN_ALERTS,
      MAX_ALERTS: MAX_ALERTS,
      MAX_CODE_LEN: MAX_CODE_LEN,
      MAX_RESERVED: MAX_RESERVED,
      MAX_RESERVED_LEN: MAX_RESERVED_LEN,
      MAX_FREQ: MAX_FREQ
    }
  };
});
