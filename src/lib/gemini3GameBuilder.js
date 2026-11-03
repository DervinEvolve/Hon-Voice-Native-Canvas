import JSON5 from 'json5';

const DEFAULT_HUD_HTML = `
<div class="hon-game-hud">
  <div class="hon-game-hud__title">Mission Status</div>
  <div class="hon-game-hud__stats">
    <div><span>Score</span><strong id="hon-hud-score">0</strong></div>
    <div><span>Health</span><strong id="hon-hud-health">100</strong></div>
  </div>
</div>
`.trim();

const DEFAULT_HUD_CSS = `
.hon-game-hud {
  position: absolute;
  top: 16px;
  left: 16px;
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(7, 14, 32, 0.85);
  color: #e0f2ff;
  font-family: 'Space Mono', 'SFMono-Regular', monospace;
  min-width: 180px;
  border: 1px solid rgba(96, 165, 250, 0.4);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
}
.hon-game-hud__title {
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.2em;
  opacity: 0.8;
  margin-bottom: 8px;
}
.hon-game-hud__stats {
  display: flex;
  gap: 14px;
}
.hon-game-hud__stats span {
  font-size: 10px;
  text-transform: uppercase;
  opacity: 0.7;
}
.hon-game-hud__stats strong {
  display: block;
  font-size: 20px;
  letter-spacing: 0.08em;
}
`.trim();

const DEFAULT_HUD_UPDATE = `
const scoreEl = document.getElementById('hon-hud-score');
const healthEl = document.getElementById('hon-hud-health');
if (scoreEl) scoreEl.textContent = Math.round(state.score ?? 0);
if (healthEl) healthEl.textContent = Math.max(0, Math.round(state.health ?? 100));
`.trim();

const escapeTemplate = (value = '') =>
  value.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const stripMarkdownFences = (code = '') =>
  code.replace(/```[\s\S]*$/g, '').trimEnd();

const braceBalance = (code = '') => {
  let balance = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      balance += 1;
    } else if (char === '}') {
      balance -= 1;
    }
  }
  return balance;
};

const sanitizeBlock = (code = '') => {
  let result = stripMarkdownFences(code || '');
  let balance = braceBalance(result);
  while (balance < 0) {
    const lastBrace = result.lastIndexOf('}');
    if (lastBrace === -1) break;
    result = `${result.substring(0, lastBrace)}${result.substring(lastBrace + 1)}`.trimEnd();
    balance = braceBalance(result);
  }
  while (balance > 0) {
    result = `${result}\n}`;
    balance -= 1;
  }
  return result.trimEnd();
};

const indent = (code = '', depth = 2) => {
  const pad = ' '.repeat(depth);
  return code
    .split('\n')
    .map((line) => (line.trim().length ? pad + line : line))
    .join('\n');
};

export function extractGeminiGameSpec(rawText = '') {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty Gemini response');
  }
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Unable to locate JSON object in Gemini response');
  }
  const jsonSlice = rawText.slice(start, end + 1);
  try {
    return JSON.parse(jsonSlice);
  } catch (err) {
    try {
      return JSON5.parse(jsonSlice);
    } catch (err5) {
      const preview = jsonSlice.slice(0, 200).replace(/\s+/g, ' ');
      throw new Error(`Failed to parse Gemini JSON (preview="${preview}"): ${(err5 && err5.message) || err5}`);
    }
  }
}

export function buildGeminiGameCodeFromSpec(spec = {}) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('Gemini spec missing or invalid');
  }

  const metadata = spec.metadata || {};
  const hud = spec.hud || {};
  const helpers = sanitizeBlock(spec.helpers || '');
  const cleanup = sanitizeBlock(spec.cleanup || '');
  const onGameOver = sanitizeBlock(spec.onGameOver || '');

  const stateBlock = (spec.state && spec.state.trim()) ? spec.state.trim() : 'const state = { score: 0, health: 100, wave: 1 };';
  const setupBlock = sanitizeBlock(spec.setup && spec.setup.trim() ? spec.setup.trim() : '// TODO: setup not provided');
  const updateBlock = sanitizeBlock(spec.update && spec.update.trim() ? spec.update.trim() : '// TODO: update not provided');
  const hudHtml = escapeTemplate(hud.html ? hud.html.trim() : DEFAULT_HUD_HTML);
  const hudCss = escapeTemplate(hud.css ? hud.css.trim() : DEFAULT_HUD_CSS);
  const hudUpdate = hud.update && hud.update.trim() ? hud.update.trim() : DEFAULT_HUD_UPDATE;

  const titleComment = metadata.title ? `// Gemini Game: ${metadata.title}` : '// Gemini Game';
  const summaryComment = metadata.summary ? `// Summary: ${metadata.summary}` : '';

  return `
${titleComment}
${summaryComment}
(() => {
  const HUD_ID = 'hon-game-hud-' + Math.random().toString(36).slice(2);
  const STYLE_ID = HUD_ID + '-style';

  try {
    document.getElementById(HUD_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
  } catch {}

  const hudRoot = document.createElement('div');
  hudRoot.id = HUD_ID;
  hudRoot.style.position = 'fixed';
  hudRoot.style.inset = '0';
  hudRoot.style.width = '100%';
  hudRoot.style.height = '100%';
  hudRoot.style.pointerEvents = 'none';
  hudRoot.style.zIndex = '2147483647';
  hudRoot.style.display = 'flex';
  hudRoot.style.flexDirection = 'column';
  hudRoot.style.justifyContent = 'space-between';
  hudRoot.innerHTML = \`
${indent(hudHtml, 2)}
  \`;

  const hudStyle = document.createElement('style');
  hudStyle.id = STYLE_ID;
  hudStyle.textContent = \`
${hudCss}
  \`;

  document.body.appendChild(hudStyle);
  document.body.appendChild(hudRoot);

  let __rngSeed = (Date.now() % 2147483647) || 1;
  const rng = () => {
    __rngSeed = (__rngSeed * 48271) % 2147483647;
    return __rngSeed / 2147483647;
  };

  const game = {
    state: {},
    objects: {},
    metadata: ${JSON.stringify(metadata || null)}
  };
  game.hudRoot = hudRoot;

  ((context) => {
    try {
${indent(stateBlock, 6)}
    } catch (err) {
      console.warn('[GeminiGame] state block failed:', err);
    }
  })({ game, state: game.state, objects: game.objects, THREE, scene, camera });

  ((context) => {
    try {
${indent(helpers, 6)}
    } catch (err) {
      console.warn('[GeminiGame] helper block failed:', err);
    }
  })({ game, state: game.state, objects: game.objects, THREE, scene, camera, hudRoot });

  let finishGame = () => {};

  const buildCtx = (extra = {}) => ({
    THREE,
    scene,
    camera,
    game,
    state: game.state,
    objects: game.objects,
    hudRoot,
    finishGame,
    rng,
    ...extra
  });

  const runtime = {
    setup: (incoming = {}) => {
      const ctx = buildCtx(incoming);
      try {
${indent(setupBlock, 8)}
      } catch (err) {
        console.warn('[GeminiGame] setup failed:', err);
      }
    },
    update: (incoming = {}) => {
      const ctx = buildCtx(incoming);
      try {
        const deltaTime = ctx.deltaTime ?? 0;
        const input = ctx.input ?? ctx.inputs ?? {};
        const inputs = input;
        if (!inputs.keys) {
          inputs.keys = (ctx.input && ctx.input.keys) || (ctx.inputs && ctx.inputs.keys) || {};
        }
        if (!inputs.mouse) {
          inputs.mouse = (ctx.input && ctx.input.mouse) || (ctx.inputs && ctx.inputs.mouse) || {};
        }
        const game = ctx.game;
        const state = ctx.game?.state ?? {};
        const objects = ctx.game?.objects ?? {};
${indent(updateBlock, 8)}
      } catch (err) {
        console.warn('[GeminiGame] update failed:', err);
      }
    },
    updateHud: (incoming = {}) => {
      const ctx = buildCtx(incoming);
      try {
${indent(hudUpdate, 8)}
      } catch (err) {
        console.warn('[GeminiGame] hud update failed:', err);
      }
    },
    cleanup: (incoming = {}) => {
      const ctx = buildCtx(incoming);
      try {
${indent(cleanup, 8)}
      } catch (err) {
        console.warn('[GeminiGame] cleanup failed:', err);
      }
    },
    handleGameOver: (incoming = {}) => {
      const ctx = buildCtx(incoming);
      try {
${indent(onGameOver, 8)}
      } catch (err) {
        console.warn('[GeminiGame] onGameOver failed:', err);
      }
    }
  };

  finishGame = (reason = 'lose') => {
    if (scene.userData.gameOver) return;
    scene.userData.gameOver = true;
    try {
      runtime.handleGameOver(buildCtx({ reason }));
    } catch (err) {
      console.warn('[GeminiGame] handleGameOver failed:', err);
    }
  };

  runtime.setup();
  scene.userData.gameOver = false;
  scene.userData.state = game.state;
  scene.userData.game = game;

  scene.userData.update = (ctx = {}) => {
    const merged = {
      deltaTime: ctx.deltaTime ?? 0,
      input: ctx.input ?? {},
      time: ctx.time ?? performance.now() / 1000
    };
    runtime.update(merged);
    runtime.updateHud(merged);
  };

  scene.userData.cleanup = () => {
    try {
      runtime.cleanup();
    } catch (err) {
      console.warn('[GeminiGame] cleanup handler failed:', err);
    }
    try {
      Object.values(game.objects || {}).forEach((obj) => {
        if (!obj) return;
        try { obj.parent?.remove?.(obj); } catch {}
        try { obj.geometry?.dispose?.(); } catch {}
        try {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((mat) => mat?.dispose?.());
          } else {
            obj.material?.dispose?.();
          }
        } catch {}
      });
      game.objects = {};
    } catch (err) {
      console.warn('[GeminiGame] object cleanup failed:', err);
    }
    try {
      document.getElementById(HUD_ID)?.remove();
      document.getElementById(STYLE_ID)?.remove();
    } catch {}
  };
})();
`.trim();
}

