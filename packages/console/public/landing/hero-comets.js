(() => {
  // gsap-shim.js
  var gsap = window.gsap;

  // heroComets.ts
  var DEFAULT_COMET_CONFIG = {
    count: 15,
    speedMin: 870,
    speedMax: 1040,
    tailMin: 210,
    tailMax: 220,
    widthMin: 1.25,
    widthMax: 2.25,
    brightnessMin: 0.65,
    brightnessMax: 0.78,
    gapMin: 2.7,
    gapMax: 2.8,
    falloff: 1.4,
    taper: 0.1,
    glow: 0,
    twinkle: 0,
    headShade: "300",
    tailShade: "500"
  };
  var SHADE_CLASS = {
    "300": "text-brand-shades-300",
    "400": "text-brand-shades-400",
    "500": "text-brand-shades-500",
    "600": "text-brand-shades-600"
  };
  var SAMPLES = 128;
  var TAIL_POINTS = 20;
  var TAIL_STOPS = 6;
  var WAITING = -1;
  function sampleTrack(path) {
    const length = path.getTotalLength();
    const xs = new Float32Array(SAMPLES);
    const ys = new Float32Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      const p = path.getPointAtLength(i / (SAMPLES - 1) * length);
      xs[i] = p.x;
      ys[i] = p.y;
    }
    return { length, xs, ys };
  }
  function resolveShade(shade) {
    const probe = document.createElement("span");
    probe.className = SHADE_CLASS[shade];
    probe.hidden = true;
    document.body.appendChild(probe);
    const css = getComputedStyle(probe).color;
    probe.remove();
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b];
  }
  var lerp = (a, b, t) => a + (b - a) * t;
  function createHeroComets(options, initial = {}) {
    const { svg, paths, canvas, clip } = options;
    const ctx = canvas.getContext("2d");
    let config = { ...DEFAULT_COMET_CONFIG, ...initial };
    let colors = { head: resolveShade(config.headShade), tail: resolveShade(config.tailShade) };
    const tracks = paths.map(sampleTrack);
    const vb = svg.viewBox.baseVal;
    let scale = 1;
    let dpr = 1;
    let visible = true;
    const comets = [];
    const speedOf = (c) => lerp(config.speedMin, config.speedMax, c.rSpeed);
    const tailUnits = (c) => lerp(config.tailMin, config.tailMax, c.rTail) / scale;
    function roll(c) {
      c.track = Math.floor(Math.random() * tracks.length);
      c.rSpeed = Math.random();
      c.rTail = Math.random();
      c.rWidth = Math.random();
      c.rBright = Math.random();
      c.twinkleRate = gsap.utils.random(2, 7);
      c.twinklePhase = Math.random() * Math.PI * 2;
    }
    function launch(c, from, delay = 0) {
      c.tween?.kill();
      const end = tracks[c.track].length + tailUnits(c);
      const duration = Math.max(0, (end - from) * scale / speedOf(c));
      c.s = delay > 0 ? WAITING : from;
      c.tween = gsap.fromTo(c, { s: from }, {
        s: end,
        duration,
        delay,
        ease: "none",
        immediateRender: false,
        onComplete: () => {
          roll(c);
          launch(c, 0, gsap.utils.random(config.gapMin, config.gapMax));
        }
      });
      if (!visible) c.tween.pause();
    }
    function spawn(scattered) {
      const c = {};
      roll(c);
      const end = tracks[c.track].length + tailUnits(c);
      launch(c, scattered ? Math.random() * end : 0);
      comets.push(c);
    }
    function resize() {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      scale = rect.width / vb.width || 1;
    }
    const toX = (x) => (x - vb.x) * scale;
    const toY = (y) => (y - vb.y) * scale;
    function pointAt(track, s) {
      const f = s / track.length * (SAMPLES - 1);
      const i = Math.min(SAMPLES - 2, Math.max(0, Math.floor(f)));
      const t = f - i;
      return [lerp(track.xs[i], track.xs[i + 1], t), lerp(track.ys[i], track.ys[i + 1], t)];
    }
    let glow = null;
    function glowSprite() {
      const key = `${config.glow}|${dpr}|${colors.head}`;
      if (glow?.key === key) return glow.sprite;
      const size = Math.max(1, Math.ceil(config.glow * 2 * dpr));
      const sprite = document.createElement("canvas");
      sprite.width = sprite.height = size;
      const g = sprite.getContext("2d");
      const [r, gr, b] = colors.head;
      const halo = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      halo.addColorStop(0, `rgba(${r},${gr},${b},0.6)`);
      halo.addColorStop(1, `rgba(${r},${gr},${b},0)`);
      g.fillStyle = halo;
      g.fillRect(0, 0, size, size);
      glow = { key, sprite };
      return sprite;
    }
    const xs = new Float32Array(TAIL_POINTS + 1);
    const ys = new Float32Array(TAIL_POINTS + 1);
    function render(time) {
      if (!visible) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      const clipLeft = clip ? toX(clip.x) : -Infinity;
      if (clip) {
        ctx.beginPath();
        ctx.rect(clipLeft, toY(clip.y), clip.width * scale, clip.height * scale);
        ctx.clip();
      }
      const sprite = config.glow > 0 ? glowSprite() : null;
      for (const c of comets) {
        if (c.s === WAITING) continue;
        const track = tracks[c.track];
        const tail = tailUnits(c);
        const width = lerp(config.widthMin, config.widthMax, c.rWidth);
        const twinkle = 1 - config.twinkle * 0.5 * (1 + Math.sin(time * c.twinkleRate + c.twinklePhase));
        const bright = lerp(config.brightnessMin, config.brightnessMax, c.rBright) * twinkle;
        const tA = Math.max(0, (c.s - track.length) / tail);
        const tB = Math.min(1, c.s / tail);
        if (tB <= tA) continue;
        for (let j = 0; j <= TAIL_POINTS; j++) {
          const t = lerp(tA, tB, j / TAIL_POINTS);
          const [x, y] = pointAt(track, c.s - t * tail);
          xs[j] = toX(x);
          ys[j] = toY(y);
        }
        if (xs[0] < clipLeft - config.glow) continue;
        ctx.beginPath();
        for (let side = 1; side >= -1; side -= 2) {
          for (let n = 0; n <= TAIL_POINTS; n++) {
            const j = side === 1 ? n : TAIL_POINTS - n;
            const a = Math.max(0, j - 1);
            const b2 = Math.min(TAIL_POINTS, j + 1);
            const dx = xs[b2] - xs[a];
            const dy = ys[b2] - ys[a];
            const len = Math.hypot(dx, dy) || 1;
            const t = lerp(tA, tB, j / TAIL_POINTS);
            const half = Math.max(0.3, width * (1 - config.taper * t)) / 2 * side;
            const x = xs[j] - dy / len * half;
            const y = ys[j] + dx / len * half;
            if (side === 1 && n === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
        const fade = ctx.createLinearGradient(xs[0], ys[0], xs[TAIL_POINTS], ys[TAIL_POINTS]);
        for (let k = 0; k <= TAIL_STOPS; k++) {
          const t = lerp(tA, tB, k / TAIL_STOPS);
          const alpha = bright * Math.pow(1 - t, config.falloff);
          const r2 = lerp(colors.head[0], colors.tail[0], t) | 0;
          const g2 = lerp(colors.head[1], colors.tail[1], t) | 0;
          const b2 = lerp(colors.head[2], colors.tail[2], t) | 0;
          fade.addColorStop(k / TAIL_STOPS, `rgba(${r2},${g2},${b2},${alpha})`);
        }
        ctx.fillStyle = fade;
        ctx.fill();
        if (c.s > track.length) continue;
        const px = xs[0];
        const py = ys[0];
        if (sprite) {
          ctx.globalAlpha = bright;
          ctx.drawImage(sprite, px - config.glow, py - config.glow, config.glow * 2, config.glow * 2);
          ctx.globalAlpha = 1;
        }
        const [r, g, b] = colors.head;
        ctx.fillStyle = `rgba(${r},${g},${b},${bright})`;
        ctx.beginPath();
        ctx.arc(px, py, width * 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    const tick = () => render(gsap.ticker.time);
    resize();
    for (let i = 0; i < config.count; i++) spawn(true);
    gsap.ticker.add(tick);
    const resizeObserver = new ResizeObserver(() => {
      resize();
      comets.forEach((c) => c.tween?.isActive() && launch(c, c.s));
    });
    resizeObserver.observe(canvas);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      comets.forEach((c) => visible ? c.tween?.resume() : c.tween?.pause());
      if (!visible) ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
    intersectionObserver.observe(canvas);
    return {
      update(next) {
        const prev = config;
        config = { ...config, ...next };
        if (config.headShade !== prev.headShade) colors.head = resolveShade(config.headShade);
        if (config.tailShade !== prev.tailShade) colors.tail = resolveShade(config.tailShade);
        while (comets.length < config.count) spawn(true);
        while (comets.length > config.count) comets.pop().tween?.kill();
        const timing = ["speedMin", "speedMax", "tailMin", "tailMax"].some((k) => config[k] !== prev[k]);
        if (timing) comets.forEach((c) => c.tween?.isActive() && launch(c, c.s));
      },
      /** Re-reads brand colours, e.g. after a theme switch. */
      refreshColors() {
        colors = { head: resolveShade(config.headShade), tail: resolveShade(config.tailShade) };
      },
      destroy() {
        gsap.ticker.remove(tick);
        comets.forEach((c) => c.tween?.kill());
        comets.length = 0;
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
  }

  // entry.ts
  window.createHeroComets = createHeroComets;
})();
