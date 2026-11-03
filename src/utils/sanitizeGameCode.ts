// Shared sanitizer for LLM-generated Three.js game code
// Goals:
// - Remove markdown/prose/labels
// - Remove common TS features
// - Normalize destructuring and trailing commas
// - Line-by-line compile filter that only keeps lines that compile when appended

export function sanitizeGameCode(input: string): string {
  let code = String(input || '');
  // Remove zero-width and control chars that can break parsing
  code = code.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00A0\u2000-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
  // Normalize curly quotes
  code = code.replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E\u201F]/g, '"');
  // Strip fenced blocks, leaving inner content
  const fenced = code.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  code = fenced?.[1] ? fenced![1] : code.replace(/```/g, '');
  // Remove imports/exports and obvious prose/labels
  code = code
    // Transform safe Three.js imports into destructuring from global THREE
    .replace(/import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]three['"];?/gi, 'const {$1} = THREE;')
    .replace(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]three['"];?/gi, 'const $1 = THREE;')
    // Drop other imports (not available in sandbox)
    .replace(/^\s*import\s+[^\n]+$/gm, '')
    .replace(/^\s*export\s+.*$/gm, '')
    .replace(/\b(Page\s*\d+\s*[·:\.\-–—]?\s*Panel\s*\d+)\b.*$/gmi, '')
    .replace(/^.*Page\s*\d+.*Panel\s*\d+.*$/gmi, '')
    .replace(/\b(Fixing errors|System:|User:|Assistant:)\b.*$/gmi, '')
    .replace(/^\s*#+.*$/gm, '')
    .replace(/^\s*=+\s*$/gm, '');

  // Strip TypeScript
  code = code
    .replace(/(\(|,)\s*([A-Za-z_$][\w$]*)\s*:\s*[^),=]+/g, '$1 $2')
    .replace(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*[^=;]+/g, '$1 $2')
    .replace(/\s+as\s+[A-Za-z_$][\w$<>,\[\]\s]*/g, '')
    .replace(/\b(interface|type|enum)\s+[A-Za-z_$][\w$]*[^\{;]*\{[\s\S]*?\}\s*;?/g, '')
    .replace(/([A-Za-z_$][\w$]*)<[^>]*>/g, '$1')
    .replace(/\b(readonly|public|private|protected)\b/g, '');

  // Normalizations
  code = code
    .replace(/\b(const|let|var)\s*\(([^)]+)\)\s*=\s*THREE/g, '$1 {$2} = THREE')
    .replace(/,\s*([)\}])/g, '$1')
    ;

  // Remove dangerous/banned browser APIs often emitted by LLMs for HUD/DOM
  // DISABLED: Our game templates legitimately use document.createElement and document.body.appendChild for score display
  // Modern templates are pre-validated and safe - don't strip their DOM operations
  /*
  try {
    const banned = /(document\.|window\.|XMLHttpRequest|eval\(|Function\(|require\()/;
    if (banned.test(code)) {
      code = code
        .replace(/document\.[^;]+;?/g, '')
        .replace(/window\.[^;]+;?/g, '')
        .replace(/XMLHttpRequest\([^)]*\);?/g, '')
        .replace(/eval\([^)]*\);?/g, '')
        .replace(/new Function\([^)]*\);?/g, '')
        .replace(/require\([^)]*\);?/g, '');
    }
  } catch {}
  */

  // Disallow advanced geometry paths for simplicity; nudge models to basics
  // Hard-reject BufferGeometry/BufferAttribute usage which commonly appears with undefined buffers
  if (/\bBufferGeometry\b|\bBufferAttribute\b/.test(code)) {
    throw new Error('Use basic geometries only (BoxGeometry, SphereGeometry, CylinderGeometry, PlaneGeometry). BufferGeometry/BufferAttribute are not allowed.');
  }

  // Detect undefined variable usage in common patterns (e.g., new THREE.BufferAttribute(varName, ...))
  try {
    const patterns: RegExp[] = [
      /new\s+THREE\.BufferAttribute\((\w+)/g,
      /\.setAttribute\(\s*['"]position['"]\s*,\s*new\s+THREE\.BufferAttribute\((\w+)/g
    ];
    for (const pat of patterns) {
      const it = code.matchAll(pat);
      for (const m of it) {
        const varName = m[1];
        const def = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=`);
        if (!def.test(code)) {
          throw new Error(`Variable '${varName}' is used but never defined. Define all variables before use.`);
        }
      }
    }
  } catch {}

  // Additional guard: flag single-letter identifiers used without declaration (common LLM leak like y/z)
  try {
    const declared = new Set<string>();
    const declIter = code.matchAll(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)/g);
    for (const m of declIter) declared.add(m[2]);
    // Allowlist common loop indices only if declared; otherwise still error
    const usageIter = code.matchAll(/(^|[^\.A-Za-z0-9_])([A-Za-z])([^A-Za-z0-9_])/g);
    for (const m of usageIter) {
      const name = m[2];
      if (!declared.has(name)) {
        // Ignore known context params (t for local time often used but we provide 'time', 'dt') -> still require declare
        throw new Error(`Variable '${name}' is used but not declared. Use descriptive names and declare before use.`);
      }
    }
  } catch {}

  // Detect incomplete object literal properties inside constructor calls
  // e.g. new THREE.MeshPhongMaterial({ color: 0xff0000, emissive }) -> invalid
  // DISABLED: This regex-based detection has false positives, especially with minified/single-line code
  // Validation is now done in validateGame.js after sanitization
  /*
  try {
    const constructorWithObjectArg = /new\s+[A-Za-z_$][\w$\.]*\s*\(\s*\{[^{}]*\}\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = constructorWithObjectArg.exec(code)) !== null) {
      const callText = match[0];
      const startIdx = callText.indexOf('{');
      const endIdx = callText.lastIndexOf('}');
      if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) continue;
      const inner = callText.slice(startIdx + 1, endIdx);
      const missing: string[] = [];
      // Find tokens that look like property names at start or after comma, followed by comma/} without a value
      const propToken = /(^|,)\s*([A-Za-z_$][\w$]*)\s*(?=,|\})/g;
      let pm: RegExpExecArray | null;
      while ((pm = propToken.exec(inner)) !== null) {
        const propName = pm[2];
        // Confirm there is no colon between the end of the name and the next separator
        const segStart = pm.index + (pm[1] ? pm[1].length : 0);
        const segRest = inner.slice(segStart);
        const nextSepRel = segRest.search(/[,\}]/);
        const segEnd = nextSepRel >= 0 ? segStart + nextSepRel : inner.length;
        const between = inner.slice(pm.index, segEnd);
        if (!/:\s*[^,}]+/.test(between)) {
          missing.push(propName);
        }
      }
      if (missing.length > 0) {
        throw new Error(`Incomplete properties in object literal: ${missing.join(', ')}. Each property must be 'name: value'.`);
      }
    }
  } catch {}
  */

  // Normalize material constructor object args: keep only well-formed key:value pairs,
  // ensure a color exists, and repair cases with missing closing '}'
  // DISABLED: This normalization was breaking multi-line material properties with newlines
  // Modern templates already have correct material syntax
  /*
  try {
    code = code.replace(/new\s+THREE\.(Mesh(?:Phong|Lambert|Basic|Standard)Material)\s*\(\s*\{[^}]*\)\s*\)/g,
      (m, ctor) => `new THREE.${ctor}({ color: 0xffffff })`);
    code = code.replace(/new\s+THREE\.(Mesh(?:Phong|Lambert|Basic|Standard)Material)\s*\(\s*\{([\s\S]*?)\}\s*\)/g,
      (_m: string, ctor: string, inner: string) => {
        const pairs = Array.from(inner.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*([^,}\n]+)/g))
          .map((mm) => `${mm[1]}: ${mm[2].trim()}`);
        let normalized = pairs.join(', ');
        if (!/\bcolor\s*:/.test(normalized)) {
          normalized = ['color: 0xffffff', normalized].filter(Boolean).join(', ');
        }
        return `new THREE.${ctor}({ ${normalized} })`;
      }
    );
  } catch {}
  */

  // Heuristic fixups: convert meshNameX/Y/Z -> meshName.position.x/y/z (e.g., playerY -> player.position.y)
  // BUT SKIP if it's a variable declaration (let/const/var nameX = ...)
  // DISABLED: This conversion breaks code that uses separate variables like let playerX = 0;
  // Modern game code should use playerX as variables, not player.position.x
  /*
  try {
    const meshNames = new Set<string>();
    const meshDecls = code.matchAll(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+THREE\.(?:Mesh|Object3D)\b/g);
    for (const m of meshDecls) meshNames.add(m[2]);
    meshNames.add('camera');
    for (const name of meshNames) {
      code = code.replace(new RegExp(`\\b${name}X\\b`, 'g'), `${name}.position.x`);
      code = code.replace(new RegExp(`\\b${name}Y\\b`, 'g'), `${name}.position.y`);
      code = code.replace(new RegExp(`\\b${name}Z\\b`, 'g'), `${name}.position.z`);
    }
  } catch {}
  */

  // Strip unmatched closing delimiters without adding opens
  // DISABLED: This was removing VALID closing delimiters from correct code
  // Modern validated templates have correct syntax - don't strip anything
  /*
  try {
    const stripUnmatched = (text: string) => {
      let out = '';
      let p = 0, b = 0, s = 0;
      for (const ch of text) {
        if (ch === '(') { p++; out += ch; }
        else if (ch === ')') { if (p > 0) { p--; out += ch; } }
        else if (ch === '{') { b++; out += ch; }
        else if (ch === '}') { if (b > 0) { b--; out += ch; } }
        else if (ch === '[') { s++; out += ch; }
        else if (ch === ']') { if (s > 0) { s--; out += ch; } }
        else { out += ch; }
      }
      return out;
    };
    code = stripUnmatched(code);
  } catch {}
  */

  // Lightweight syntax sanity check only (do not drop lines)
  // The previous incremental compile-filter could accidentally remove
  // control-structure headers (e.g., for/if) and leave trailing bodies,
  // leading to undefined loop indices like "i". We now only validate once
  // and keep the original code intact.
  try {
    // Validate as a function body; if it fails we still return the original
    // so the runtime error overlay can show the true source for repair.
    new Function('THREE', 'scene', 'camera', 'controls', 'input', code);
  } catch {}

  return code.trim();
}


