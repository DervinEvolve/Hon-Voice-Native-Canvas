import * as React from 'react';
import { GAME_FRAME_SANDBOX, readGameFrameMessage } from '../../utils/gameFrameSecurity';

interface IframeGameViewerProps {
  code: string;
  panelId?: string;
  className?: string;
  onStarted?: () => void;
  onError?: (message: string) => void;
  onGameOver?: () => void;
  visible?: boolean;
  reloadKey?: number;
}

export const IframeGameViewer: React.FC<IframeGameViewerProps> = ({ code, panelId, className, onStarted, onError, onGameOver, visible = true, reloadKey = 0 }) => {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const pendingCodeRef = React.useRef<string>('');
  const lastLoadedKeyRef = React.useRef<number>(-1);
  const receivedMessagesRef = React.useRef(new Set<string>());
  React.useEffect(() => { receivedMessagesRef.current.clear(); }, [panelId, reloadKey]);

  // Build Full HTML harness for the iframe
  const buildSrcDoc = React.useCallback((rawCode: string) => {
    // BYPASS SANITIZER - Modern validated templates don't need sanitization
    // Sanitization was destroying valid code (removing parentheses, etc.)
    let safe = rawCode || ''; // sanitizeGameCode(rawCode || '');

    // Clean markdown code fences first (before HTML detection)
    safe = safe
      .replace(/^```html\s*/i, '')
      .replace(/^```javascript\s*/i, '')
      .replace(/^```js\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/\s*```$/,  '')
      .trim();

    // DETECT HTML/CSS INTERACTIVE SCENES
    // If the code is already a complete HTML document, return it directly
    const isCompleteHtml = safe.trim().toLowerCase().startsWith('<!doctype html') || 
                           safe.trim().toLowerCase().startsWith('<html');
    
    if (isCompleteHtml) {
      // It's already a complete HTML document (interactive scene)
      // Just return it with minimal wrapping for communication with parent
      const htmlWithMessaging = safe.replace(
        '</body>',
        `<script>
          // Notify parent that scene is ready
          window.addEventListener('message', (e) => {
            if (e.source !== window.parent) return;
            if (e.data?.type === 'resize' || e.data?.type === 'force-reflow') {
              window.dispatchEvent(new Event('resize'));
            }
          });
          try {
            window.parent.postMessage({ type: 'hon-game-started', panelId: '${panelId || 'unknown'}' }, '*');
          } catch(e) {}
        </script>
        </body>`
      );
      return htmlWithMessaging;
    }

    const stripDanglingIdentifiers = (code: string) => {
      const lines = code.replace(/\s+$/, '').split('\n');
      const danglingPatterns = [
        /^[A-Za-z_$][\w$]*$/,
        /^[A-Za-z_$][\w$]*\s*=$/,
        /[=+\-*/]\s*$/,
        /[,\.]$/
      ];
      while (lines.length) {
        const last = lines[lines.length - 1].trim();
        if (!last) {
          lines.pop();
          continue;
        }
        if (danglingPatterns.some((pattern) => pattern.test(last))) {
          lines.pop();
          continue;
        }
        break;
      }
      return lines.join('\n');
    };

    const stripUnbalancedTail = (code: string) => {
      const text = code.replace(/\r/g, '');
      let inSingle = false;
      let inDouble = false;
      let inTemplate = false;
      let inLineComment = false;
      let inBlockComment = false;
      let escapeNext = false;
      const stack: string[] = [];
      let lastSafe = 0;

      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];

        if (inLineComment) {
          if (char === '\n') {
            inLineComment = false;
            lastSafe = stack.length ? lastSafe : i + 1;
          }
          continue;
        }
        if (inBlockComment) {
          if (char === '*' && next === '/') {
            inBlockComment = false;
            i++;
          }
          continue;
        }
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        if (char === '\\') {
          escapeNext = true;
          continue;
        }
        if (inSingle) {
          if (char === "'") inSingle = false;
          continue;
        }
        if (inDouble) {
          if (char === '"') inDouble = false;
          continue;
        }
        if (inTemplate) {
          if (char === '`') {
            inTemplate = false;
          } else if (char === '$' && next === '{') {
            stack.push('{');
            i++;
          }
          continue;
        }

        if (char === '/' && next === '/') {
          inLineComment = true;
          i++;
          continue;
        }
        if (char === '/' && next === '*') {
          inBlockComment = true;
          i++;
          continue;
        }
        if (char === "'") { inSingle = true; continue; }
        if (char === '"') { inDouble = true; continue; }
        if (char === '`') { inTemplate = true; continue; }

        if (char === '(' || char === '{' || char === '[') {
          stack.push(char);
        } else if (char === ')' || char === '}' || char === ']') {
          const expected = char === ')' ? '(' : char === '}' ? '{' : '[';
          if (stack.length && stack[stack.length - 1] === expected) {
            stack.pop();
          } else {
            return text.slice(0, lastSafe).trimEnd();
          }
        }

        if (!stack.length && !inSingle && !inDouble && !inTemplate && !inLineComment && !inBlockComment) {
          lastSafe = i + 1;
        }
      }

      if (stack.length || inSingle || inDouble || inTemplate || inBlockComment) {
        return text.slice(0, lastSafe).trimEnd();
      }
      return text.trimEnd();
    };
    
    // Clean unbalanced code and strip dangling identifiers
    safe = stripUnbalancedTail(safe).trim();
    
    safe = stripDanglingIdentifiers(safe);
    
    try {
      const buildCameraOverride = (ctor: string, args?: string) => {
        const trimmedArgs = (args || '').trim();
        const ctorCall = trimmedArgs.length ? `(${trimmedArgs})` : `()`;
        return `
(() => {
  try {
    const __honCamera = new THREE.${ctor}Camera${ctorCall};
    if (camera) {
      if ('fov' in __honCamera) camera.fov = __honCamera.fov;
      if ('zoom' in __honCamera) camera.zoom = __honCamera.zoom;
      if ('top' in __honCamera) {
        camera.left = __honCamera.left !== undefined ? __honCamera.left : camera.left;
        camera.right = __honCamera.right !== undefined ? __honCamera.right : camera.right;
        camera.top = __honCamera.top !== undefined ? __honCamera.top : camera.top;
        camera.bottom = __honCamera.bottom !== undefined ? __honCamera.bottom : camera.bottom;
      }
      camera.near = __honCamera.near;
      camera.far = __honCamera.far;
      if (typeof camera.updateProjectionMatrix === 'function') {
        camera.updateProjectionMatrix();
      }
      if (camera.position && __honCamera.position) {
        camera.position.copy(__honCamera.position);
      }
      if (camera.quaternion && __honCamera.quaternion) {
        camera.quaternion.copy(__honCamera.quaternion);
      }
    }
  } catch (err) {
    console.warn('[GameViewer] Failed to apply camera override', err);
  }
})();`;
      };

      // Remove explicit scene/camera/renderer re-definitions that conflict with the sandbox
      safe = safe
        .replace(/\b(const|let|var)\s+scene\s*=\s*new\s+THREE\.Scene\s*\([^)]*\)\s*;?/gi, '')
        .replace(/\bnew\s+THREE\.Scene\s*\([^)]*\)\s*;?/gi, '')
        .replace(/\bnew\s+THREE\.WebGLRenderer\s*\([^)]*\)\s*;?/gi, '')
        .replace(/\brenderer\.render\s*\([^)]*\)\s*;?/gi, '')
        .replace(/\b(const|let|var)\s+camera\s*=\s*new\s+THREE\.(Perspective|Orthographic|Cube|Array)\s*Camera\s*\(([^)]*)\)\s*;?/gi, (_match, _kw, ctor, args) => buildCameraOverride(ctor, args))
        .replace(/\b(const|let|var)\s+camera\b[^\n;]*[;\n]?/gi, '');
    } catch {}
    const jsonCode = JSON.stringify(safe);
    const pid = String(panelId || 'unknown');
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#root{position:fixed;inset:0}</style>
    <script src="https://unpkg.com/three@0.160.0/build/three.min.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script>
      try {
        const root = document.getElementById('root');
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        const canvas = renderer.domElement;
        canvas.tabIndex = 0;
        root.appendChild(canvas);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
        camera.position.set(0, 1.6, 6);
        const amb = new THREE.AmbientLight(0xffffff, 0.6); scene.add(amb);
        const dir = new THREE.DirectionalLight(0xffffff, 0.8); dir.position.set(5,10,7); scene.add(dir);
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(40,40), new THREE.MeshLambertMaterial({ color: 0x111111 }));
        ground.rotation.x = -Math.PI/2; ground.position.y = 0; scene.add(ground);
        const __baselineChildren = scene.children.length;
        scene.userData = scene.userData || {};
        
        // 3D Model Loader Helper - for Meshy and other GLB/GLTF files
        // Load GLTFLoader dynamically
        let GLTFLoaderPromise = null;
        window.loadModel3D = async function(url, options = {}) {
          if (!GLTFLoaderPromise) {
            GLTFLoaderPromise = import('https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js').then(m => m.GLTFLoader);
          }
          const GLTFLoader = await GLTFLoaderPromise;
          const loader = new GLTFLoader();
          return new Promise((resolve, reject) => {
            loader.load(
              url,
              (gltf) => {
                const model = gltf.scene || gltf;
                if (options.position) model.position.set(options.position.x || 0, options.position.y || 0, options.position.z || 0);
                if (options.scale) {
                  const scale = typeof options.scale === 'number' ? options.scale : (options.scale || {});
                  if (typeof scale === 'number') {
                    model.scale.set(scale, scale, scale);
                  } else {
                    model.scale.set(scale.x || 1, scale.y || 1, scale.z || 1);
                  }
                }
                if (options.rotation) model.rotation.set(options.rotation.x || 0, options.rotation.y || 0, options.rotation.z || 0);
                scene.add(model);
                resolve(model);
              },
              undefined,
              (error) => reject(error)
            );
          });
        };

        const fit = () => { const w = root.clientWidth, h = root.clientHeight; renderer.setSize(w, h, false); camera.aspect = w/h || 1; camera.updateProjectionMatrix(); };
        new ResizeObserver(fit).observe(root);
        fit();

        const __shim=new Proxy(function(){},{get:()=>__shim,apply:()=>__shim,construct:()=>__shim});
        var retro=__shim,gsap=__shim,TWEEN=__shim,noise=__shim,SimplexNoise=__shim,ShaderPass=__shim,EffectComposer=__shim,composer=__shim,postprocessing=__shim,OrbitControls=__shim;

        // Basic input handling - normalize key codes to match template format
        const input = { keys:{}, mouse:{ x:0, y:0, dx:0, dy:0, buttons:0 }, pointerLocked:false };
        document.addEventListener('keydown', e => { 
          input.keys[e.code] = true;
          // Also set normalized lowercase key for template compatibility
          if (e.code === 'KeyW') input.keys.w = true;
          if (e.code === 'KeyA') input.keys.a = true;
          if (e.code === 'KeyS') input.keys.s = true;
          if (e.code === 'KeyD') input.keys.d = true;
          if (e.code === 'ArrowUp') input.keys.ArrowUp = true;
          if (e.code === 'ArrowDown') input.keys.ArrowDown = true;
          if (e.code === 'ArrowLeft') input.keys.ArrowLeft = true;
          if (e.code === 'ArrowRight') input.keys.ArrowRight = true;
          if (e.code === 'Space') input.keys.space = true;
        });
        document.addEventListener('keyup', e => { 
          input.keys[e.code] = false;
          // Also clear normalized keys
          if (e.code === 'KeyW') input.keys.w = false;
          if (e.code === 'KeyA') input.keys.a = false;
          if (e.code === 'KeyS') input.keys.s = false;
          if (e.code === 'KeyD') input.keys.d = false;
          if (e.code === 'ArrowUp') input.keys.ArrowUp = false;
          if (e.code === 'ArrowDown') input.keys.ArrowDown = false;
          if (e.code === 'ArrowLeft') input.keys.ArrowLeft = false;
          if (e.code === 'ArrowRight') input.keys.ArrowRight = false;
          if (e.code === 'Space') input.keys.space = false;
        });
        canvas.addEventListener('click', () => { canvas.requestPointerLock?.(); });
        document.addEventListener('pointerlockchange', () => { input.pointerLocked = (document.pointerLockElement === canvas); });
        document.addEventListener('mousemove', e => { if (input.pointerLocked) { input.mouse.dx += e.movementX||0; input.mouse.dy += e.movementY||0; } });

        // Audio context helper (lazy, user-gesture safe)
        window.audioContext = null;
        window.getAudioContext = function() {
          try {
            if (window.audioContext) return window.audioContext;
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return null;
            const ctx = new Ctx();
            window.audioContext = ctx;
            return ctx;
          } catch (_) { return null; }
        };
        const tryResumeAudio = () => {
          try {
            const ctx = window.getAudioContext?.();
            if (ctx && ctx.state !== 'running') { ctx.resume?.(); }
          } catch {}
        };
        // Ensure autoplay policies are satisfied on first gesture
        document.addEventListener('click', tryResumeAudio, { once: true });
        document.addEventListener('keydown', tryResumeAudio, { once: true });
        document.addEventListener('touchstart', tryResumeAudio, { once: true, passive: true });

        // Visibility pause support
        let __paused = false;
        window.addEventListener('message', (e) => {
          try {
            if (e.source !== window.parent) return;
            const d = e?.data || {};
            if (d && d.type === 'visibility') {
              __paused = !d.visible;
            } else if (d && (d.type === 'force-reflow' || d.type === 'resize')) {
              try { fit(); } catch {}
              try { setTimeout(fit, 50); } catch {}
            } else if (d && d.type === 'hon-focus-canvas') {
              try { canvas?.focus?.(); } catch {}
              try { setTimeout(() => canvas?.focus?.(), 50); } catch {}
            }
          } catch {}
        });

        // Add default lighting if none exists after user code
        const checkAndAddDefaults = () => {
          // Check if scene has any lights
          let hasLight = false;
          scene.traverse((child) => {
            if (child.isLight) hasLight = true;
          });
          
          // If no lights, add basic lighting to prevent black screen
          if (!hasLight) {
            const ambient = new THREE.AmbientLight(0x404040);
            scene.add(ambient);
            const directional = new THREE.DirectionalLight(0xffffff, 0.5);
            directional.position.set(5, 10, 5);
            scene.add(directional);
            console.warn('No lights detected - added default lighting');
          }
        };

        // Simple static validator for common authoring mistakes
        function validateVariables(code) {
          try {
            const known = new Set(['THREE','scene','camera','controls','input','Math','console','window','document']);
            const usagePattern = /\b([A-Za-z_$][\w$]*)\s*[\.\[]/g;
            const definePattern = /\b(const|let|var)\s+([A-Za-z_$][\w$]*)/g;
            const defined = new Set();
            let m;
            while ((m = definePattern.exec(code)) !== null) defined.add(m[2]);
            const used = new Set();
            while ((m = usagePattern.exec(code)) !== null) {
              const name = m[1];
              if (!known.has(name)) used.add(name);
            }
            const missing = Array.from(used).filter(n => !defined.has(n));
            if (missing.length) throw new Error('Undefined variables detected: ' + missing.join(', '));
          } catch (e) {
            throw e;
          }
        }

        const userCode = ${jsonCode};
        console.log('[Game] Executing user code, length:', userCode.length);
        console.log('[Game] First 500 chars of code:', userCode.substring(0, 500));
        let __userError = false;
        let __startedSent = false;
        let __frames = 0;
        let __gameOverSent = false;
        try { 
          // Preflight: basic undefined-variable scan before executing
          if (userCode && userCode.length > 0) {
            try { validateVariables(userCode); } catch (ve) { throw ve; }
          }
          (new Function('THREE','scene','camera','controls','input', userCode))(THREE, scene, camera, {}, input);
          // Add defaults after user code runs
          checkAndAddDefaults();
          console.log('[Game] Code executed successfully');
          console.log('[Game] Scene children:', scene.children.length);
          console.log('[Game] Scene children details:', scene.children.map(c => ({type: c.type, name: c.name})));
          console.log('[Game] scene.userData.update is defined:', typeof scene.userData.update === 'function');
          if (typeof scene.userData.update === 'function') {
            console.log('[Game] Update function:', scene.userData.update.toString().substring(0, 200));
          }
        } catch (e) {
          __userError = true;
          console.error('[Game] Code execution error:', e);
          parent.postMessage({ type: 'hon-game-error', panelId: '${pid}', message: e?.message || String(e) }, '*');
        }

        let last = performance.now();
        let __loggedOnce = false;
        renderer.setAnimationLoop((t) => {
          if (__paused) { return; }
          try {
            if (typeof scene.userData.update === 'function') {
              const now = performance.now();
              const deltaTime = (now - last) / 1000;
              const updateCtx = {
                deltaTime,
                dt: deltaTime,
                time: now / 1000,
                input,
                inputs: input,
                scene,
                camera,
                THREE
              };
              scene.userData.input = input;
              scene.userData.inputs = input;
              scene.userData.deltaTime = deltaTime;
              if (!__loggedOnce) {
                console.log('[Game] Animation loop running, calling update with deltaTime:', deltaTime);
                __loggedOnce = true;
              }
              try {
                if (scene.userData.update.length >= 2) {
                  scene.userData.update(deltaTime, input, updateCtx);
                } else {
                  scene.userData.update(updateCtx);
                }
              } catch (updateErr) {
                try {
                  scene.userData.update({ deltaTime, dt: deltaTime, input, inputs: input, scene, camera, THREE });
                } catch (fallbackErr) {
                  throw fallbackErr;
                }
              }
              last = now;
            }
          } catch(e){
            console.error('[Game] Error in update loop:', e);
          }
          try { renderer.render(scene, camera); __frames++; } catch(e){}
          
          // Send started only once when user-added objects exist beyond baseline and at least 2 frames rendered
          const __hasExtraObjects = scene.children.length > __baselineChildren;
          if (!__startedSent && !__userError && __hasExtraObjects && __frames > 1) {
            __startedSent = true;
            parent.postMessage({ type: 'hon-game-started', panelId: '${pid}' }, '*');
          }
          // Detect simple game-over convention: scene.userData.gameOver or scene.userData.state.gameOver
          try {
            const sd = scene.userData || {};
            const go = !!(sd.gameOver || (sd.state && sd.state.gameOver));
            if (!__gameOverSent && go) {
              __gameOverSent = true;
              console.log('[Game] Game Over detected! Sending message to parent');
              parent.postMessage({ type: 'hon-game-over', panelId: '${pid}' }, '*');
            }
          } catch {}
          // reset per-frame deltas
          input.mouse.dx = 0; input.mouse.dy = 0;
        });
      } catch (err) {
        parent.postMessage({ type: 'hon-game-error', panelId: '${pid}', message: err?.message || String(err) }, '*');
      }
    </script>
  </body>
  </html>`;
  }, [panelId]);

  // Track pending code when not visible
  React.useEffect(() => {
    if (code) {
      pendingCodeRef.current = code;
    }
  }, [code, reloadKey]);

  // React to code updates - only execute when visible
  React.useEffect(() => {
    if (!iframeRef.current) return;
    
    // When not visible, just track that we have pending code
    if (!visible) {
      console.log('[IframeGameViewer] Not visible, storing pending code:', {
        panelId,
        codeLength: code?.length || 0,
        reloadKey
      });
      return;
    }
    
    // When becoming visible, use either current code or pending code
    const codeToLoad = code || pendingCodeRef.current || '';
    
    // Skip if we've already loaded this exact key (prevents duplicate loads)
    if (lastLoadedKeyRef.current === reloadKey && !codeToLoad) {
      console.log('[IframeGameViewer] Skipping - already loaded this reloadKey:', reloadKey);
      return;
    }
    
    if (codeToLoad) {
      console.log('[IframeGameViewer] Loading code:', {
        panelId,
        codeLength: codeToLoad.length,
        reloadKey,
        visible,
        lastLoadedKey: lastLoadedKeyRef.current,
        firstChars: codeToLoad.substring(0, 200),
        lastChars: codeToLoad.substring(codeToLoad.length - 200)
      });
      
      lastLoadedKeyRef.current = reloadKey;
      const doc = buildSrcDoc(String(codeToLoad));
      try { iframeRef.current.srcdoc = doc; } catch {}
      // After setting srcdoc, try nudging layout inside the iframe shortly after mount
      const w = iframeRef.current?.contentWindow;
      try { setTimeout(() => { try { w?.postMessage({ type: 'force-reflow' }, '*'); } catch {} }, 60); } catch {}
      try { setTimeout(() => { try { w?.postMessage({ type: 'force-reflow' }, '*'); } catch {} }, 180); } catch {}
    }
  }, [code, buildSrcDoc, reloadKey, visible, panelId]);

  // Forward visibility hints to the iframe to pause/resume
  React.useEffect(() => {
    try { iframeRef.current?.contentWindow?.postMessage({ type: 'visibility', visible }, '*'); } catch {}
  }, [visible]);

  React.useEffect(() => {
    if (!visible) return;
    const win = iframeRef.current?.contentWindow;
    try { win?.focus(); } catch {}
    const timer = setTimeout(() => {
      try { iframeRef.current?.contentWindow?.postMessage({ type: 'hon-focus-canvas' }, '*'); } catch {}
    }, 100);
    return () => clearTimeout(timer);
  }, [visible, reloadKey]);

  // Listen for child messages and forward to logging endpoint
  React.useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const data = readGameFrameMessage(e, iframeRef.current?.contentWindow, panelId);
      if (!data) return;
      // A broken generated loop must not turn messages into unbounded API logs.
      const key = `${data.type}:${data.message}`;
      const seen = receivedMessagesRef.current;
      if (seen.size >= 20 || seen.has(key)) return;
      seen.add(key);
      const stage = data.type === 'hon-game-started' ? 'started' : (data.type === 'hon-game-error' ? 'execute_error' : data.type);
      try { fetch('/api/game/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panelId, stage, message: data?.message || '' }) }); } catch {}
      if (data.type === 'hon-game-started') { try { onStarted?.(); } catch {} }
      if (data.type === 'hon-game-error')   { try { onError?.(String(data?.message || 'error')); } catch {} }
      if (data.type === 'hon-game-over')    { try { onGameOver?.(); } catch {} }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [panelId, reloadKey, onStarted, onError, onGameOver]);

  // Handle external reflow requests from parent components
  React.useEffect(() => {
    const onForce = (e: any) => {
      try {
        if (!e?.detail || (panelId && e.detail.panelId !== panelId)) return;
        // Toggle display to force paint, then ask child to resize
        if (iframeRef.current) {
          const el = iframeRef.current as HTMLIFrameElement;
          const prev = el.style.display;
          el.style.display = 'none';
          // force reflow
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          (el as any).offsetHeight;
          el.style.display = prev || 'block';
          try { el.contentWindow?.postMessage({ type: 'force-reflow' }, '*'); } catch {}
        }
      } catch {}
    };
    
    const onForceRender = (e: any) => {
      try {
        if (!e?.detail || (panelId && e.detail.panelId !== panelId)) return;
        if (iframeRef.current) {
          const el = iframeRef.current as HTMLIFrameElement;
          // More aggressive: actually remove and re-add the iframe to DOM
          const parent = el.parentElement;
          if (parent) {
            const nextSibling = el.nextSibling;
            parent.removeChild(el);
            // Force a reflow
            void parent.offsetHeight;
            // Re-insert the iframe
            if (nextSibling) {
              parent.insertBefore(el, nextSibling);
            } else {
              parent.appendChild(el);
            }
            // Wait a frame then trigger resize
            requestAnimationFrame(() => {
              try { el.contentWindow?.postMessage({ type: 'force-reflow' }, '*'); } catch {}
            });
          }
        }
      } catch {}
    };
    
    document.addEventListener('hon-iframe-force-reflow', onForce as any);
    document.addEventListener('hon-iframe-force-render', onForceRender as any);
    return () => {
      document.removeEventListener('hon-iframe-force-reflow', onForce as any);
      document.removeEventListener('hon-iframe-force-render', onForceRender as any);
    };
  }, [panelId]);

  return (
    <div className={className} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <iframe
        ref={iframeRef}
        title={`game-${panelId || 'panel'}`}
        sandbox={GAME_FRAME_SANDBOX}
        referrerPolicy="no-referrer"
        allow="camera 'none'; microphone 'none'; geolocation 'none'"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', background: 'black', visibility: visible ? 'visible' : 'hidden', opacity: visible ? 1 : 0, transition: 'opacity 0.2s ease-in-out' }}
        onLoad={() => { try { iframeRef.current?.contentWindow?.postMessage({ type: 'force-reflow' }, '*'); } catch {} }}
      />
    </div>
  );
};


