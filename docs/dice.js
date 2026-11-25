// 双骰组件：U（上面）/ D（下面）两个骰子
// 支持两种模式：
//   - preset: 传入预设点数，动画后固定显示预设结果（正式实验轮次，不可真随机）
//   - random: 真实随机（仅练习试次使用，点数固定为 1-6 / 2-5 / 3-4 之一，U/D 朝向随机）
(function () {
  const DIE_DOTS = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8]
  };

  function setDieFace(n, prefix) {
    const grid = document.getElementById('dieGrid' + prefix);
    if (!grid) return;
    grid.classList.toggle('unrolled', n == null);
    const cells = grid.querySelectorAll('.dot');
    cells.forEach((dot, i) => {
      dot.classList.toggle('on', (DIE_DOTS[n] || []).indexOf(i) >= 0);
    });
  }

  // 真实随机组合：点数固定为 1-6 / 2-5 / 3-4 之一，U/D 对应随机
  function randomPracticePair() {
    const pairs = [[1, 6], [2, 5], [3, 4]];
    const p = pairs[Math.floor(Math.random() * pairs.length)];
    return Math.random() < 0.5 ? { u: p[0], d: p[1] } : { u: p[1], d: p[0] };
  }

  function initDicePair(opts) {
    opts = opts || {};
    const prefix = opts.prefix || '';
    const btn = document.getElementById('diceBtn' + prefix);
    const dieU = document.getElementById('dieU' + prefix);
    const dieD = document.getElementById('dieD' + prefix);
    const numU = document.getElementById('dieNumU' + prefix);
    const numD = document.getElementById('dieNumD' + prefix);
    const tip = document.getElementById('diceTip' + prefix);
    const preset = opts.preset || null;
    let locked = false;

    function apply(u, d) {
      setDieFace(u, 'U' + prefix);
      setDieFace(d, 'D' + prefix);
      if (numU) numU.textContent = u + ' 点';
      if (numD) numD.textContent = d + ' 点';
    }

    setDieFace(null, 'U' + prefix);
    setDieFace(null, 'D' + prefix);

    if (btn) {
      btn.addEventListener('click', () => {
        if (locked) return;
        locked = true;
        btn.disabled = true;
        if (tip) tip.textContent = '骰子滚动中...';
        if (dieU) dieU.classList.remove('rolling');
        if (dieD) dieD.classList.remove('rolling');
        if (dieU) { void dieU.offsetWidth; dieU.classList.add('rolling'); }
        if (dieD) { void dieD.offsetWidth; dieD.classList.add('rolling'); }
        let frames = 0;
        const interval = setInterval(() => {
          setDieFace(Math.floor(Math.random() * 6) + 1, 'U' + prefix);
          setDieFace(Math.floor(Math.random() * 6) + 1, 'D' + prefix);
          frames++;
          if (frames >= 10) clearInterval(interval);
        }, 85);
        setTimeout(() => {
          let u, d;
          if (preset) { u = preset.u; d = preset.d; }
          else { const rp = randomPracticePair(); u = rp.u; d = rp.d; }
          apply(u, d);
          if (dieU) dieU.classList.remove('rolling');
          if (dieD) dieD.classList.remove('rolling');
          if (tip) tip.textContent = '已掷出，请查看结果（不可再次投掷）';
          if (typeof opts.onRolled === 'function') opts.onRolled(u, d);
        }, 1000);
      });
    }

    return {
      show: apply,
      isLocked: function () { return locked; },
      lock: function () { locked = true; if (btn) btn.disabled = true; },
      unlock: function () { locked = false; if (btn) btn.disabled = false; }
    };
  }

  window.initDicePair = initDicePair;
  window.setDieFace = setDieFace;
})();
