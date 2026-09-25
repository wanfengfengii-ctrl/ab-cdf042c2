/* 工作台前端逻辑：草稿录入、求解调用、码树与明细渲染、本地草稿持久化 */
(function () {
  'use strict';

  var DRAFT_KEY = 'quake-code-workbench:draft:v1';
  var MIN_ALERTS = CodeSolver.constants.MIN_ALERTS;
  var MAX_ALERTS = CodeSolver.constants.MAX_ALERTS;

  var SAMPLE = {
    alerts: [
      { name: '破坏性地震（震中附近）', freq: '800', minLen: '1', maxLen: '12' },
      { name: '强有感地震预警', freq: '300', minLen: '1', maxLen: '12' },
      { name: '有感地震提示', freq: '90', minLen: '1', maxLen: '12' },
      { name: '远场大震通报', freq: '30', minLen: '1', maxLen: '12' },
      { name: '余震序列提示', freq: '12', minLen: '2', maxLen: '12' },
      { name: '演练与测试电文', freq: '3', minLen: '3', maxLen: '12' }
    ],
    reserved: ['1101', '', '']
  };

  /* ---------------- 状态 ---------------- */

  var draft = emptyDraft();
  var lastResult = null; // 当前展示的结论；输入一变动立即清空

  function emptyDraft() {
    return {
      alerts: [0, 1, 2, 3, 4].map(function () {
        return { name: '', freq: '', minLen: '2', maxLen: '8' };
      }),
      reserved: ['', '', '']
    };
  }

  function activeReserved() {
    return draft.reserved.map(function (s) { return (s || '').trim(); }).filter(Boolean);
  }

  /* ---------------- DOM 小工具 ---------------- */

  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* ---------------- DOM 引用 ---------------- */

  var el = {
    alertsTbody: document.getElementById('alertsTbody'),
    alertsCountHint: document.getElementById('alertsCountHint'),
    btnAddAlert: document.getElementById('btnAddAlert'),
    reservedWrap: document.getElementById('reservedWrap'),
    btnGenerate: document.getElementById('btnGenerate'),
    btnSample: document.getElementById('btnSample'),
    btnClear: document.getElementById('btnClear'),
    errorBanner: document.getElementById('errorBanner'),
    resultPlaceholder: document.getElementById('resultPlaceholder'),
    resultBody: document.getElementById('resultBody'),
    resultStatus: document.getElementById('resultStatus'),
    sumCost: document.getElementById('sumCost'),
    sumMax: document.getElementById('sumMax'),
    sumReserved: document.getElementById('sumReserved'),
    treeWrap: document.getElementById('treeWrap'),
    detailTbody: document.getElementById('detailTbody'),
    detailTotal: document.getElementById('detailTotal'),
    reservedDetail: document.getElementById('reservedDetail'),
    draftState: document.getElementById('draftState')
  };

  /* ---------------- 草稿持久化 ---------------- */

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      el.draftState.textContent = '本地草稿已保存 · ' + timeNow();
      el.draftState.classList.add('dirty');
    } catch (e) { /* 隐私模式等场景下静默降级 */ }
  }

  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (!d || !Array.isArray(d.alerts) || !Array.isArray(d.reserved)) return false;
      if (d.alerts.length < MIN_ALERTS || d.alerts.length > MAX_ALERTS) return false;
      draft = {
        alerts: d.alerts.map(function (a) {
          return {
            name: String(a.name || ''),
            freq: a.freq == null ? '' : String(a.freq),
            minLen: a.minLen == null ? '' : String(a.minLen),
            maxLen: a.maxLen == null ? '' : String(a.maxLen)
          };
        }),
        reserved: [0, 1, 2].map(function (i) { return d.reserved[i] ? String(d.reserved[i]) : ''; })
      };
      el.draftState.textContent = '已载入本地草稿 · ' + timeNow();
      el.draftState.classList.add('dirty');
      return true;
    } catch (e) { return false; }
  }

  function timeNow() {
    var d = new Date();
    function p(x) { return String(x).padStart(2, '0'); }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* 输入变动：保存草稿，且旧结论立即作废 */
  function markChanged() {
    saveDraft();
    invalidate('草稿已修改，旧结论已作废，请重新点击「生成码表」。');
  }

  function invalidate(msg) {
    lastResult = null;
    el.resultBody.hidden = true;
    el.resultStatus.textContent = '';
    el.resultStatus.className = 'result-status';
    el.errorBanner.hidden = true;
    el.resultPlaceholder.hidden = false;
    el.resultPlaceholder.textContent = msg;
  }

  /* ---------------- 输入区渲染 ---------------- */

  function makeField(tag, attrs, value, oninput) {
    var inp = h(tag);
    Object.keys(attrs || {}).forEach(function (k) { inp.setAttribute(k, attrs[k]); });
    inp.value = value == null ? '' : value;
    inp.addEventListener('input', oninput);
    return inp;
  }

  function renderAlerts() {
    clear(el.alertsTbody);
    draft.alerts.forEach(function (a, i) {
      var tr = h('tr');
      tr.appendChild(h('td', 'idx-cell col-idx', String(i + 1)));

      var nameTd = h('td');
      nameTd.appendChild(makeField('input',
        { type: 'text', maxlength: '40', placeholder: '例如：强有感地震预警' },
        a.name,
        function (e) { draft.alerts[i].name = e.target.value; markChanged(); }));
      tr.appendChild(nameTd);

      var freqTd = h('td', 'num-cell');
      freqTd.appendChild(makeField('input',
        { type: 'number', min: '1', step: '1', placeholder: '如 300' },
        a.freq,
        function (e) { draft.alerts[i].freq = e.target.value; markChanged(); }));
      tr.appendChild(freqTd);

      var loTd = h('td', 'num-cell');
      loTd.appendChild(makeField('input',
        { type: 'number', min: '1', max: '24', step: '1' },
        a.minLen,
        function (e) { draft.alerts[i].minLen = e.target.value; markChanged(); }));
      tr.appendChild(loTd);

      var hiTd = h('td', 'num-cell');
      hiTd.appendChild(makeField('input',
        { type: 'number', min: '1', max: '24', step: '1' },
        a.maxLen,
        function (e) { draft.alerts[i].maxLen = e.target.value; markChanged(); }));
      tr.appendChild(hiTd);

      var opTd = h('td', 'col-op');
      var del = h('button', 'btn-row-del', '✕');
      del.type = 'button';
      del.title = '删除该行（至少保留 ' + MIN_ALERTS + ' 类）';
      del.addEventListener('click', function () {
        if (draft.alerts.length <= MIN_ALERTS) return;
        draft.alerts.splice(i, 1);
        renderAll();
        markChanged();
      });
      opTd.appendChild(del);
      tr.appendChild(opTd);

      el.alertsTbody.appendChild(tr);
    });
    el.alertsCountHint.textContent =
      draft.alerts.length + ' / ' + MAX_ALERTS + ' 类（至少 ' + MIN_ALERTS + ' 类）';
    el.btnAddAlert.disabled = draft.alerts.length >= MAX_ALERTS;
  }

  function renderReserved() {
    clear(el.reservedWrap);
    draft.reserved.forEach(function (val, i) {
      var wrap = h('label', 'reserved-input');
      wrap.appendChild(h('span', 'slot-tag', 'P' + (i + 1)));
      wrap.appendChild(makeField('input',
        { type: 'text', maxlength: '32', placeholder: '0/1 前缀，如 1101（可留空）', spellcheck: 'false' },
        val,
        function (e) { draft.reserved[i] = e.target.value; markChanged(); }));
      el.reservedWrap.appendChild(wrap);
    });
  }

  function renderAll() {
    renderAlerts();
    renderReserved();
  }

  /* ---------------- 生成与结果渲染 ---------------- */

  el.btnAddAlert.addEventListener('click', function () {
    if (draft.alerts.length >= MAX_ALERTS) return;
    draft.alerts.push({ name: '', freq: '', minLen: '2', maxLen: '8' });
    renderAll();
    markChanged();
  });

  el.btnSample.addEventListener('click', function () {
    draft = {
      alerts: SAMPLE.alerts.map(function (a) {
        return { name: a.name, freq: a.freq, minLen: a.minLen, maxLen: a.maxLen };
      }),
      reserved: SAMPLE.reserved.slice()
    };
    saveDraft();
    renderAll();
    invalidate('已载入示例参数，点击「生成码表」查看最优编配。');
  });

  el.btnClear.addEventListener('click', function () {
    draft = emptyDraft();
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    el.draftState.textContent = '草稿已清空';
    el.draftState.classList.remove('dirty');
    renderAll();
    invalidate('草稿已清空。录入警报名称、频次、码长区间与保留前缀后，点击「生成码表」。');
  });

  el.btnGenerate.addEventListener('click', function () {
    var model = {
      alerts: draft.alerts.map(function (a) {
        return {
          name: String(a.name || ''),
          freq: a.freq === '' || a.freq == null ? NaN : Number(a.freq),
          minLen: a.minLen === '' || a.minLen == null ? NaN : Number(a.minLen),
          maxLen: a.maxLen === '' || a.maxLen == null ? NaN : Number(a.maxLen)
        };
      }),
      reserved: activeReserved()
    };
    var res;
    try {
      res = CodeSolver.solve(model);
    } catch (e) {
      showFatal(e);
      return;
    }
    if (!res.ok && res.kind === 'validation') {
      showValidationErrors(res.errors);
      return;
    }
    el.errorBanner.hidden = true;
    if (!res.ok) {
      showInfeasible(res);
      return;
    }
    lastResult = res;
    renderResult(res);
  });

  function showValidationErrors(errors) {
    lastResult = null;
    el.resultBody.hidden = true;
    el.resultPlaceholder.hidden = true;
    el.resultStatus.textContent = '输入未通过校验';
    el.resultStatus.className = 'result-status fail';
    el.errorBanner.hidden = false;
    clear(el.errorBanner);
    el.errorBanner.appendChild(h('span', null, '请修正以下问题后重新生成：'));
    var ul = h('ul');
    errors.forEach(function (m) { ul.appendChild(h('li', null, m)); });
    el.errorBanner.appendChild(ul);
  }

  function showFatal(e) {
    lastResult = null;
    el.resultBody.hidden = true;
    el.resultPlaceholder.hidden = true;
    el.resultStatus.textContent = '求解异常';
    el.resultStatus.className = 'result-status fail';
    el.errorBanner.hidden = false;
    el.errorBanner.textContent = '求解器发生内部错误：' + (e && e.message ? e.message : e);
  }

  function showInfeasible(res) {
    el.resultStatus.textContent = '无可用完整分配';
    el.resultStatus.className = 'result-status fail';
    el.resultBody.hidden = true;
    el.resultPlaceholder.hidden = false;
    el.resultPlaceholder.textContent = '当前参数下不存在满足全部约束的完整编配。';
    el.errorBanner.hidden = false;
    clear(el.errorBanner);
    var strong = h('strong', null, '没有可用的完整分配。');
    el.errorBanner.appendChild(strong);
    el.errorBanner.appendChild(h('p', 'banner-reason', res.reason));
    var ul = h('ul');
    [
      '可尝试放宽某类警报的码长上限；',
      '检查保留前缀是否遮蔽了过多码空间（当前可用空间占比 ' + formatSpaceRatio(res.diagnostics) + '）；',
      '确认每类均只要求一条码字后重新生成。'
    ].forEach(function (m) { ul.appendChild(h('li', null, m)); });
    el.errorBanner.appendChild(ul);
  }

  function formatSpaceRatio(d) {
    var ratio = d.spaceUnits / Math.pow(2, d.scale);
    return (ratio * 100).toFixed(3) + '%';
  }

  function renderResult(res) {
    el.resultPlaceholder.hidden = true;
    el.errorBanner.hidden = true;
    el.resultStatus.textContent = '已生成最优码表';
    el.resultStatus.className = 'result-status ok';
    el.resultBody.hidden = false;

    el.sumCost.textContent = res.cost.toLocaleString('zh-CN');
    el.sumMax.textContent = res.maxLen + ' bit';
    clear(el.sumReserved);
    if (res.reserved.length) {
      res.reserved.forEach(function (r, i) {
        if (i > 0) el.sumReserved.appendChild(document.createTextNode(' '));
        el.sumReserved.appendChild(bitPill(r));
      });
    } else {
      el.sumReserved.textContent = '无';
    }

    renderDetail(res);
    renderReservedDetail(res);
    clear(el.treeWrap);
    el.treeWrap.appendChild(buildTreeSvg(res));
    el.draftState.textContent = '码表已生成 · ' + timeNow();
    el.draftState.classList.remove('dirty');
  }

  function renderDetail(res) {
    clear(el.detailTbody);
    var maxContrib = Math.max.apply(null, res.assignment.map(function (a) { return a.contribution; }));
    res.assignment.forEach(function (a, i) {
      var tr = h('tr');
      tr.appendChild(h('td', 'col-idx idx-cell', String(i + 1)));
      tr.appendChild(h('td', null, a.name));
      tr.appendChild(h('td', 'col-num mono', a.freq.toLocaleString('zh-CN')));
      var codeTd = h('td');
      codeTd.appendChild(bitPill(a.code));
      tr.appendChild(codeTd);
      tr.appendChild(h('td', 'col-num mono', String(a.length)));
      var pct = maxContrib > 0 ? Math.max(3, Math.round(a.contribution / maxContrib * 100)) : 0;
      var contribTd = h('td', 'col-num mono bar-cell', a.contribution.toLocaleString('zh-CN'));
      var bar = h('span', 'bar');
      var fill = h('i');
      fill.setAttribute('style', 'width:' + pct + '%');
      bar.appendChild(fill);
      contribTd.appendChild(bar);
      tr.appendChild(contribTd);
      el.detailTbody.appendChild(tr);
    });
    el.detailTotal.textContent = res.cost.toLocaleString('zh-CN');
  }

  function renderReservedDetail(res) {
    clear(el.reservedDetail);
    if (!res.reserved.length) {
      el.reservedDetail.appendChild(
        h('span', 'empty-note', '本次编配未设置保留前缀，整棵码树均可用。'));
      return;
    }
    res.reserved.forEach(function (r) {
      var rest = 32 - r.length;
      var row = h('div', 'reserved-row');
      row.appendChild(bitPill(r));
      row.appendChild(h('span', 'reserved-range',
        '前缀 ' + r + ' 覆盖深度 ' + r.length + ' 以下的整棵子树'));
      row.appendChild(h('span', 'hint',
        '遮蔽 2^' + rest + ' / 2^32 个叶节点；任何分配码字不得落入或遮蔽该分支'));
      el.reservedDetail.appendChild(row);
    });
  }

  function bitPill(s) {
    return h('span', 'code-pill', String(s));
  }

  /* ---------------- 二叉码树 SVG ---------------- */

  function buildTreeSvg(res) {
    // 紧凑 Trie：只展开通往分配码字 / 保留前缀的路径，空缺兄弟画成未使用叶。
    var root = { children: {}, leaf: null };
    res.assignment.forEach(function (a) {
      insertPath(root, a.code, { type: 'code', code: a.code, name: a.name });
    });
    res.reserved.forEach(function (r) {
      insertPath(root, r, { type: 'reserved', code: r, name: '保留分支' });
    });

    var SVGNS = 'http://www.w3.org/2000/svg';
    var COL_DX = 86;      // 每深入一层的横向间距
    var ROW_DY = 40;      // 每个叶槽的纵向间距
    var X0 = 30, Y0 = 26;
    var slot = 0;
    var maxDepth = 0;
    var maxCodeLen = 1;
    res.assignment.forEach(function (a) { if (a.code.length > maxCodeLen) maxCodeLen = a.code.length; });
    res.reserved.forEach(function (r) { if (r.length > maxCodeLen) maxCodeLen = r.length; });
    var leafW = Math.max(168, 26 + maxCodeLen * 8);

    function measure(node, depth) {
      if (node.leaf) {
        node._slot = slot++;
        if (depth > maxDepth) maxDepth = depth;
        return;
      }
      [0, 1].forEach(function (b) {
        if (node.children[b]) measure(node.children[b], depth + 1);
        else { node['_empty' + b] = slot++; if (depth + 1 > maxDepth) maxDepth = depth + 1; }
      });
    }
    measure(root, 0);

    var width = X0 + maxDepth * COL_DX + leafW + 12;
    var height = Y0 * 2 + (slot - 1) * ROW_DY;
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'tree-svg');
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

    function yOf(s) { return Y0 + s * ROW_DY; }

    function draw(node, depth, y) {
      var x = X0 + depth * COL_DX;
      if (node.leaf) { drawLeaf(x, y, node.leaf); return; }
      var box = document.createElementNS(SVGNS, 'rect');
      box.setAttribute('x', x - 7); box.setAttribute('y', y - 7);
      box.setAttribute('width', 14); box.setAttribute('height', 14);
      box.setAttribute('rx', 4);
      box.setAttribute('class', 'tree-node-rect');
      svg.appendChild(box);
      if (depth === 0) {
        var t = document.createElementNS(SVGNS, 'text');
        t.setAttribute('x', x); t.setAttribute('y', y - 14);
        t.setAttribute('class', 'tree-root-text');
        t.setAttribute('text-anchor', 'middle');
        t.textContent = '根';
        svg.appendChild(t);
      }
      [0, 1].forEach(function (b) {
        var child = node.children[b];
        var cy = child ? childY(child) : yOf(node['_empty' + b]);
        var edgeCls = !child ? 'tree-edge-empty'
          : (child.leaf && child.leaf.type === 'reserved') ? 'tree-edge-reserved'
          : 'tree-edge';
        drawEdge(x, y, X0 + (depth + 1) * COL_DX, cy, edgeCls);
        if (child) draw(child, depth + 1, cy);
        else drawEmpty(X0 + (depth + 1) * COL_DX, cy, b);
      });
    }

    function childY(child) {
      if (child.leaf) return yOf(child._slot);
      var ys = [];
      [0, 1].forEach(function (b) {
        if (child.children[b]) ys.push(childY(child.children[b]));
        else ys.push(yOf(child['_empty' + b]));
      });
      return (ys[0] + ys[1]) / 2;
    }

    function drawEdge(x1, y1, x2, y2, cls) {
      var path = document.createElementNS(SVGNS, 'path');
      var mx = (x1 + x2) / 2;
      path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2);
      path.setAttribute('class', cls);
      svg.appendChild(path);
    }

    function drawEmpty(x, y, bit) {
      var c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 4);
      c.setAttribute('fill', '#3a4d60');
      svg.appendChild(c);
      var t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('x', x + 9); t.setAttribute('y', y + 4);
      t.setAttribute('class', 'tree-bit');
      t.textContent = bit + ' · 未使用';
      svg.appendChild(t);
    }

    function drawLeaf(x, y, leaf) {
      var g = document.createElementNS(SVGNS, 'g');
      var w = leafW - 18, hgt = 34;
      var rect = document.createElementNS(SVGNS, 'rect');
      rect.setAttribute('x', x - 4); rect.setAttribute('y', y - hgt / 2);
      rect.setAttribute('width', w); rect.setAttribute('height', hgt);
      rect.setAttribute('rx', 7);
      rect.setAttribute('class', leaf.type === 'code' ? 'tree-node-code' : 'tree-node-reserved');
      g.appendChild(rect);
      var code = document.createElementNS(SVGNS, 'text');
      code.setAttribute('x', x + 5); code.setAttribute('y', y - 2);
      code.setAttribute('class', leaf.type === 'code' ? 'tree-code-text' : 'tree-reserved-text');
      code.textContent = leaf.code;
      g.appendChild(code);
      var nm = document.createElementNS(SVGNS, 'text');
      nm.setAttribute('x', x + 5); nm.setAttribute('y', y + 12);
      nm.setAttribute('class', 'tree-name-text');
      nm.textContent = leaf.type === 'reserved' ? '保留分支' : truncate(leaf.name, 13);
      g.appendChild(nm);
      svg.appendChild(g);
    }

    draw(root, 0, childY(root));
    return svg;
  }

  function truncate(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function insertPath(root, path, leaf) {
    var node = root;
    for (var i = 0; i < path.length; i++) {
      var b = path[i];
      if (!node.children[b]) node.children[b] = { children: {}, leaf: null };
      node = node.children[b];
    }
    node.leaf = leaf;
  }

  /* ---------------- 启动 ---------------- */

  if (!loadDraft()) {
    el.draftState.textContent = '新草稿（仅保存在本机浏览器）';
  }
  renderAll();
  invalidate('录入警报名称、频次、码长区间与保留前缀后，点击「生成码表」。\n输入发生任何变动后，旧结论将立即作废，需重新生成。');
})();
