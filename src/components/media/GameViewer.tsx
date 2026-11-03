
import * as React from 'react';
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import nipplejs from 'nipplejs';
import { IframeGameViewer } from './IframeGameViewer';
// import { sanitizeGameCode } from '../../utils/sanitizeGameCode'; // BYPASSED - was destroying valid code

interface GameViewerProps {
  gameCode: string;
  className?: string;
  panelId?: string;
}

export const GameViewer: React.FC<GameViewerProps> = ({ gameCode, className, panelId }) => {
  const USE_IFRAME = true;
  const mountRef = React.useRef<HTMLDivElement>(null);

  // Add states
  const [error, setError] = React.useState(null);
  const [log, setLog] = React.useState<string>('');
  // removed duplicate isVisible declaration from earlier refactor
  const [isMobile, setIsMobile] = React.useState(false);
  const workerRef = React.useRef(null);
  const controlsRef = React.useRef<PointerLockControls | null>(null);
  const [runtimeCode, setRuntimeCode] = React.useState<string>('');
  const [streamingCode, setStreamingCode] = React.useState<string>('');
  const streamAbortRef = React.useRef<AbortController | null>(null);
  const [showOverlay, setShowOverlay] = React.useState<boolean>(true);
  const [gameReady, setGameReady] = React.useState<boolean>(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = React.useState<boolean>(true);
  const [fixing, setFixing] = React.useState<boolean>(false);
  const fixAttemptsRef = React.useRef<number>(0);
  const inputStateRef = React.useRef<any>({ keys: {}, mouse: { dx: 0, dy: 0, buttons: {} }, ts: 0 });
  const [reloadKey, setReloadKey] = React.useState<number>(0);
  const [displayCode, setDisplayCode] = React.useState<string>('');
  const [mounted, setMounted] = React.useState<boolean>(false);
  const [gameOver, setGameOver] = React.useState<boolean>(false);
  const [thinkingSeconds, setThinkingSeconds] = React.useState<number>(0);
  const initializedRef = React.useRef<boolean>(false);
  const overlayScrollRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => { setMounted(true); }, []);

  const overlayCode = React.useMemo(
    () => displayCode || streamingCode || runtimeCode || gameCode || '',
    [displayCode, streamingCode, runtimeCode, gameCode]
  );
  const hasPlayableCode = overlayCode.trim().length > 0;
  React.useEffect(() => {
    if (!showOverlay || hasPlayableCode) {
      setThinkingSeconds(0);
      return;
    }
    setThinkingSeconds(0);
    const timer = window.setInterval(() => {
      setThinkingSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [showOverlay, hasPlayableCode]);

  const thinkingLabel = hasPlayableCode ? '' : (thinkingSeconds > 0 ? `Thinking… (${thinkingSeconds}s)` : 'Thinking…');
  const overlayHeading = gameOver ? 'Game Over' : (hasPlayableCode ? 'Game Code' : (thinkingLabel || 'Thinking…'));

  const repairAndRetry = React.useCallback(async (errMsg: string, opts?: { mode?: 'repair' | 'rewrite' }) => {
    try {
      if (fixing) return;
      setFixing(true);
      const failingCode = (runtimeCode || gameCode || '').trim();
      if (!failingCode) { setFixing(false); return; }
      const mode = opts?.mode === 'rewrite' ? 'rewrite' : 'repair';
      const stage = mode === 'rewrite' ? 'regenerate_start' : 'repair_start';
      try { fetch('/api/game/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panelId, stage, message: errMsg }) }); } catch {}
      const res = await fetch('/api/game/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: failingCode, error: errMsg, mode })
      });
      if (!res.ok) { setFixing(false); return; }
      const data = await res.json();
      if (data?.gameCode) {
        setRuntimeCode(String(data.gameCode));
        setDisplayCode(String(data.gameCode));
        setStreamingCode('');
        setError(null);
        setShowOverlay(false);
        setGameReady(false);
        setReloadKey((k) => k + 1);
        const successStage = mode === 'rewrite' ? 'regenerate_applied' : 'repair_applied';
        try { fetch('/api/game/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panelId, stage: successStage, message: `len=${String(data.gameCode).length}` }) }); } catch {}
      }
    } catch {
      // ignore
    } finally {
      setFixing(false);
    }
  }, [panelId, runtimeCode, gameCode]);

  const DEFAULT_SNIPPET = React.useMemo(() => `
    // Simple PONG in pure Three.js (worker-safe). No DOM or renderer usage.
    // Court setup
    const ambient = new THREE.AmbientLight(0xffffff, 0.6); scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7); dirLight.position.set(4, 8, 6); scene.add(dirLight);
    const courtW = 14, courtH = 9;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(courtW, courtH), new THREE.MeshLambertMaterial({ color: 0x151515 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0; scene.add(floor);
    camera.position.set(0, 6, 12); camera.lookAt(0, 0, 0);

    // Walls (top/bottom)
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x303030 });
    const wallGeom = new THREE.BoxGeometry(courtW, 0.2, 0.5);
    const topWall = new THREE.Mesh(wallGeom, wallMat); topWall.position.set(0, 0.1, -courtH/2); scene.add(topWall);
    const botWall = new THREE.Mesh(wallGeom, wallMat); botWall.position.set(0, 0.1, courtH/2); scene.add(botWall);

    // Paddles
    const padGeom = new THREE.BoxGeometry(0.4, 0.4, 1.6);
    const leftPad = new THREE.Mesh(padGeom, new THREE.MeshLambertMaterial({ color: 0x00ff88 }));
    const rightPad = new THREE.Mesh(padGeom, new THREE.MeshLambertMaterial({ color: 0xff3366 }));
    leftPad.position.set(-courtW/2 + 0.6, 0.2, 0);
    rightPad.position.set(courtW/2 - 0.6, 0.2, 0);
    scene.add(leftPad); scene.add(rightPad);

    // Ball
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    ball.position.set(0, 0.25, 0); scene.add(ball);
    let vx = 0.08, vz = 0.06;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    // Simple AI for right paddle
    const aiSpeed = 0.08;

    // HUD-less score (kept in userData)
    scene.userData.score = { left: 0, right: 0 };

    scene.userData.update = ({ THREE }) => {
      // Move ball
      ball.position.x += vx; ball.position.z += vz;
      // Bounce top/bottom
      if (ball.position.z < -courtH/2 + 0.3) { ball.position.z = -courtH/2 + 0.3; vz = Math.abs(vz); }
      if (ball.position.z > courtH/2 - 0.3) { ball.position.z = courtH/2 - 0.3; vz = -Math.abs(vz); }
      // Paddle control: simple follow for left using ball.z to ensure gameplay works without inputs
      const follow = (target, current, speed) => current + clamp(target - current, -speed, speed);
      leftPad.position.z = follow(ball.position.z, leftPad.position.z, 0.09);
      rightPad.position.z = follow(ball.position.z, rightPad.position.z, aiSpeed);
      // Collisions with paddles
      const hitLeft = ball.position.x < leftPad.position.x + 0.35 && Math.abs(ball.position.z - leftPad.position.z) < 1.0;
      const hitRight = ball.position.x > rightPad.position.x - 0.35 && Math.abs(ball.position.z - rightPad.position.z) < 1.0;
      if (hitLeft && vx < 0) { vx = Math.abs(vx) * 1.03; vz += (ball.position.z - leftPad.position.z) * 0.02; }
      if (hitRight && vx > 0) { vx = -Math.abs(vx) * 1.03; vz += (ball.position.z - rightPad.position.z) * 0.02; }
      // Score + reset
      if (ball.position.x < -courtW/2 - 0.5) { scene.userData.score.right++; ball.position.set(0, 0.25, 0); vx = Math.abs(vx); vz = (Math.random() - 0.5) * 0.12; }
      if (ball.position.x > courtW/2 + 0.5) { scene.userData.score.left++; ball.position.set(0, 0.25, 0); vx = -Math.abs(vx); vz = (Math.random() - 0.5) * 0.12; }
    };
  `, []);

  // Live stream listeners per panelId
  React.useEffect(() => {
    if (!panelId) return;
    const onDelta = (e: any) => {
      if (!e?.detail || e.detail.panelId !== panelId) return;
      const chunk = String(e.detail.text || '');
      setStreamingCode((prev) => (prev + chunk).slice(-120000));
      // Only show overlay if game isn't already running
      if (!gameReady) {
        setShowOverlay(true);
      }
      // Keep a separate display buffer for stability
      setDisplayCode((prev) => (prev + chunk).slice(-200000));
      // Log to server for better observability (fire-and-forget)
      try { fetch('/api/game/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panelId, stage: 'delta', message: `+${chunk.length} chars`, extra: { total: (streamingCode.length + chunk.length) } }) }); } catch {}
    };
    const onRun = (e: any) => {
      if (!e?.detail || e.detail.panelId !== panelId) return;
      const raw = streamingCode || runtimeCode || gameCode || '';
      if (!raw.trim().length) {
        setShowOverlay(true);
        setGameReady(false);
        return;
      }
      // BYPASS SANITIZER - it was destroying valid code
      const codeToRun = raw; // sanitizeGameCode(raw);
      // Quick compile guard: if empty or doesn't compile, don't try to run
      try { new Function('THREE', 'scene', 'camera', 'controls', codeToRun); } catch (err) {
        setError((err as any)?.message || 'Invalid generated code');
        try { fetch('/api/game/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panelId, stage: 'execute_error', message: (err as any)?.message }) }); } catch {}
        return;
      }
      setRuntimeCode(codeToRun);
      setDisplayCode(codeToRun);
      try { fetch('/api/game/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panelId, stage: 'execute', message: `Executing code len=${codeToRun.length}` }) }); } catch {}
      // Do not hide overlay here; wait for iframe onStarted to ensure game is actually running
    };
    document.addEventListener('panel-game-code-delta', onDelta as any);
    document.addEventListener('panel-game-code-run', onRun as any);
    return () => {
      document.removeEventListener('panel-game-code-delta', onDelta as any);
      document.removeEventListener('panel-game-code-run', onRun as any);
    };
  }, [panelId]);

  // Handle initial gameCode prop if present
  React.useEffect(() => {
    if (gameCode && !initializedRef.current) {
      // Only initialize once
      initializedRef.current = true;
      
      console.log('[GameViewer] Initial gameCode detected:', {
        panelId,
        codeLength: gameCode.length,
        firstChars: gameCode.substring(0, 200),
        hasRuntime: !!runtimeCode,
        hasStreaming: !!streamingCode
      });
      
      // Add a small delay to ensure iframe is ready
      const timeoutId = setTimeout(() => {
        // BYPASS SANITIZER - was destroying valid code
        const sanitized = gameCode; // sanitizeGameCode(gameCode);
        setRuntimeCode(sanitized);
        setDisplayCode(sanitized);
        // Keep overlay visible; hide only when iframe signals started
        try { 
          fetch('/api/game/log', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ 
              panelId, 
              stage: 'initial_code', 
              message: `Using gameCode prop len=${sanitized.length}` 
            }) 
          }); 
        } catch {}
        // Remove duplicate events that might cause multiple executions
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
  }, [gameCode, panelId]);

  React.useEffect(() => {
    if (!showOverlay) return;
    const container = overlayScrollRef.current;
    if (!container) return;
    const nearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 120;
    if (nearBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }, [overlayCode, showOverlay]);

  React.useEffect(() => {
    if (USE_IFRAME) return; // In iframe mode, skip worker/main-thread renderer setup
    if (!mountRef.current) return;

    // Prefer a true sandbox: run the game inside a Web Worker using OffscreenCanvas
    try {
      const supportsOffscreen = typeof (HTMLCanvasElement.prototype as any).transferControlToOffscreen === 'function';
      if (supportsOffscreen) {
        const host = mountRef.current;
        const canvasEl = document.createElement('canvas');
        canvasEl.style.width = '100%';
        canvasEl.style.height = '100%';
        host.appendChild(canvasEl);
        const getSize = () => ({ w: host.clientWidth, h: host.clientHeight });
        const { w, h } = getSize();
        canvasEl.width = w; canvasEl.height = h;
        const offscreen: any = (canvasEl as any).transferControlToOffscreen();

        const workerSrc = `
          importScripts('https://unpkg.com/three@0.158.0/build/three.min.js');
          let renderer, scene, camera;
          let inputState = { keys: {}, mouse: { dx: 0, dy: 0, buttons: {} }, ts: 0 };
          // Deterministic RNG
          let __seed = 1337 >>> 0;
          const rng = () => { __seed = ( (__seed * 1664525) + 1013904223 ) >>> 0; return (__seed >>> 0) / 4294967296; };
          // Safe controls stub for user code
          const controlsStub = {
            enabled: true,
            isLocked: false,
            lock: () => {},
            unlock: () => {},
            getObject: () => new THREE.Object3D(),
            moveForward: () => {},
            moveRight: () => {},
            addEventListener: () => {},
            removeEventListener: () => {}
          };
          
          const init = (canvas, w, h) => {
            renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
            renderer.setSize(w, h, false);
            scene = new THREE.Scene();
            camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000);
            // Aviator-style baseline environment
            camera.position.set(0, 1.6, 6);
            const amb = new THREE.AmbientLight(0xffffff, 0.6); scene.add(amb);
            const dir = new THREE.DirectionalLight(0xffffff, 0.8); dir.position.set(5, 10, 7); scene.add(dir);
            const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshLambertMaterial({ color: 0x111111 }));
            ground.rotation.x = -Math.PI / 2; ground.position.y = 0; scene.add(ground);
            // Safe defaults in userData
            scene.userData = scene.userData || {};
            scene.userData.state = scene.userData.state || {};
            scene.userData.player = scene.userData.player || { pos: new THREE.Vector3(), vel: new THREE.Vector3(), hp: 100 };
            scene.userData.enemies = scene.userData.enemies || [];
            scene.userData.bullets = scene.userData.bullets || [];
            scene.userData.hud = scene.userData.hud || {};
            
            // Fixed-step render loop
            let last = performance.now();
            let acc = 0;
            const stepMs = 1000 / 60;
            renderer.setAnimationLoop((t) => {
              const now = performance.now();
              let dt = now - last; if (dt > 250) dt = 250; // clamp
              last = now; acc += dt;
              while (acc >= stepMs) {
                try {
                  if (scene && typeof scene.userData.update === 'function') {
                    scene.userData.update({
                      time: now,
                      dt: stepMs / 1000,
                      input: inputState,
                      rng,
                      THREE,
                      scene,
                      camera,
                      controls: controlsStub
                    });
                  }
                } catch(e) { /* keep loop alive */ }
                acc -= stepMs;
              }
              try { if (renderer && scene && camera) renderer.render(scene, camera); } catch(e) {}
            });
          };
          onmessage = (e) => {
            const msg = e.data || {};
            if (msg.type === 'init') {
              try { init(msg.canvas, msg.width, msg.height); postMessage({ type: 'ready' }); } catch (err) { postMessage({ type: 'error', message: err.message }); }
            } else if (msg.type === 'run') {
              try {
                const __prelude = "const __shim=new Proxy(function(){},{get:()=>__shim,apply:()=>__shim,construct:()=>__shim}); var retro=__shim,gsap=__shim,TWEEN=__shim,noise=__shim,SimplexNoise=__shim,ShaderPass=__shim,EffectComposer=__shim,composer=__shim,postprocessing=__shim,OrbitControls=__shim;\n";
                const code = __prelude + (msg.code || '');
                const fn = new Function('THREE', 'scene', 'camera', 'controls', code);
                fn(THREE, scene, camera, controlsStub);
                postMessage({ type: 'ok' });
              } catch (err) {
                postMessage({ type: 'error', message: err.message });
              }
            } else if (msg.type === 'resize') {
              try {
                if (camera) { camera.aspect = msg.width / msg.height; camera.updateProjectionMatrix(); }
                if (renderer) { renderer.setSize(msg.width, msg.height, false); }
              } catch (err) {
                // ignore
              }
            } else if (msg.type === 'input') {
              inputState = msg.state || inputState;
            }
          };
        `;

        workerRef.current = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'application/javascript' })), { name: 'game-worker' } as any);
        workerRef.current.onmessage = (e) => {
          const { type, message } = e.data || {};
          if (type === 'error') {
            setError(message || 'Worker error');
          }
        };
        (workerRef.current as any).postMessage({ type: 'init', canvas: offscreen, width: w, height: h }, [offscreen]);

        // Send code to worker
        const codeToRun = (runtimeCode || gameCode || '').trim();
        if (codeToRun) {
          const safeCode = codeToRun; // sanitizeGameCode(codeToRun); // BYPASSED
          (workerRef.current as any).postMessage({ type: 'run', code: safeCode });
          // Replace overlay with sanitized code so users see what runs
          setRuntimeCode(safeCode);
        }

        // Resize handling
        const onResize = () => {
          const { w: width, h: height } = getSize();
          // After transferControlToOffscreen, do NOT set canvasEl.width/height.
          // Size is controlled inside the worker via renderer.setSize.
          (workerRef.current as any)?.postMessage({ type: 'resize', width, height });
        };
        const resizeObserver = new ResizeObserver(onResize);
        resizeObserver.observe(host);
        window.addEventListener('resize', onResize);

        // Input bridge: capture keys/mouse on main thread and stream to worker
        const onKey = (ev: KeyboardEvent) => {
          (inputStateRef.current.keys as any)[ev.key?.toLowerCase?.() || ev.key] = ev.type === 'keydown';
          inputStateRef.current.ts = performance.now();
        };
        const onMouseMove = (ev: MouseEvent) => {
          if (document.pointerLockElement === host) {
            inputStateRef.current.mouse.dx += ev.movementX || 0;
            inputStateRef.current.mouse.dy += ev.movementY || 0;
            inputStateRef.current.ts = performance.now();
          }
        };
        const onMouseDown = (ev: MouseEvent) => { (inputStateRef.current.mouse.buttons as any)[ev.button] = true; inputStateRef.current.ts = performance.now(); };
        const onMouseUp = (ev: MouseEvent) => { (inputStateRef.current.mouse.buttons as any)[ev.button] = false; inputStateRef.current.ts = performance.now(); };
        host.addEventListener('click', () => { host.requestPointerLock?.(); });
        window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mousedown', onMouseDown); window.addEventListener('mouseup', onMouseUp);
        let inputRAF: number;
        const pumpInput = () => {
          (workerRef.current as any)?.postMessage({ type: 'input', state: inputStateRef.current });
          // zero per-frame deltas
          inputStateRef.current.mouse.dx = 0; inputStateRef.current.mouse.dy = 0;
          inputRAF = requestAnimationFrame(pumpInput);
        };
        inputRAF = requestAnimationFrame(pumpInput);

        // Cleanup for worker path
        return () => {
          resizeObserver.disconnect();
          window.removeEventListener('resize', onResize);
          (workerRef.current as any)?.terminate?.();
          workerRef.current = null as any;
          host.removeChild(canvasEl);
          document.exitPointerLock?.();
          window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey);
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mousedown', onMouseDown); window.removeEventListener('mouseup', onMouseUp);
          cancelAnimationFrame(inputRAF);
        };
      }
    } catch (err) {
      // Fall back to main-thread path
    }

    // Set up scene
    const scene = new THREE.Scene();
    // Seed safe userData defaults in fallback path
    (scene as any).userData = (scene as any).userData || {};
    (scene as any).userData.state = (scene as any).userData.state || {};
    (scene as any).userData.player = (scene as any).userData.player || { pos: new THREE.Vector3(), vel: new THREE.Vector3(), hp: 100 };
    (scene as any).userData.enemies = (scene as any).userData.enemies || [];
    (scene as any).userData.bullets = (scene as any).userData.bullets || [];
    (scene as any).userData.hud = (scene as any).userData.hud || {};
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    const getSize = () => ({ w: mountRef.current!.clientWidth, h: mountRef.current!.clientHeight });
    const { w, h } = getSize();
    renderer.setSize(w, h);
    mountRef.current.appendChild(renderer.domElement);

    // Pointer lock controls for FPS (guard for API differences)
    let controls: PointerLockControls | null = null;
    try {
      controls = new PointerLockControls(camera, renderer.domElement);
      controlsRef.current = controls;
      const obj = typeof (controls as any).getObject === 'function'
        ? (controls as any).getObject()
        : ((controls as any).object || null);
      if (obj) {
        scene.add(obj);
      }
      // Lock pointer on click
      if (mountRef.current && typeof (controls as any).lock === 'function') {
        mountRef.current.addEventListener('click', () => (controls as any).lock());
      }
    } catch (e) {
      console.warn('PointerLockControls unavailable:', e);
      controlsRef.current = null;
    }

    // Execute generated game code only when present
    const codeToRun = (runtimeCode || gameCode || '').trim();
    if (codeToRun.length > 0) {
      try {
        // Client-side fallback sanitizer to strip common TS before eval
        const safeCode = codeToRun; // sanitizeGameCode(codeToRun); // BYPASSED
        let executed = false;
        // Attempt 1: treat snippet as an expression that evaluates to a function
        try {
          // Preflight compile of body; if this throws, go to repair path
          new Function('THREE', 'scene', 'camera', 'controls', safeCode);
          const asFuncFactory = new Function(`try { return (${safeCode}); } catch { return null; }`);
          const maybeFn = asFuncFactory();
          if (typeof maybeFn === 'function') {
            maybeFn(THREE, scene, camera, controlsRef.current || undefined);
            executed = true;
          }
        } catch (_) {
          // ignore parse error; fall through to body execution
        }
        // Attempt 2: treat snippet as a raw function body
        if (!executed) {
          const guardedBody = `try { ${safeCode}\n } catch(e) { /* swallow body error for repair path */ }`;
          // Provide same controls stub in fallback path
          const controlsStub: any = {
            enabled: true,
            isLocked: false,
            lock: () => {},
            unlock: () => {},
            getObject: () => new THREE.Object3D(),
            moveForward: () => {},
            moveRight: () => {},
            addEventListener: () => {},
            removeEventListener: () => {}
          };
          const bodyFn = new Function('THREE', 'scene', 'camera', 'controls', `const __shim=new Proxy(function(){},{get:()=>__shim,apply:()=>__shim,construct:()=>__shim}); var retro=__shim,gsap=__shim,TWEEN=__shim,noise=__shim,SimplexNoise=__shim,ShaderPass=__shim,EffectComposer=__shim,composer=__shim,postprocessing=__shim,OrbitControls=__shim;\n` + guardedBody);
          bodyFn(THREE, scene, camera, controlsStub);
          executed = true;
        }
      } catch (error) {
        console.error('Error executing game code:', error);
        const msg = (error as Error)?.message || 'Game init failed';
        setError(msg);
        setLog(prev => (prev + `\n[eval-error] ${msg}`).slice(-4000));
        // Attempt auto-repair up to 2 times
        if (fixAttemptsRef.current < 2 && !fixing) {
          setFixing(true);
          const attempt = async () => {
            try {
              const res = await fetch('/api/game/repair', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: codeToRun, error: msg })
              });
              if (res.ok) {
                const data = await res.json();
                if (data?.gameCode) {
                  fixAttemptsRef.current += 1;
                  setRuntimeCode(String(data.gameCode));
                  setError(null);
                  return;
                }
              }
              // Fallback default snippet if repair failed and this was our last try
              if (fixAttemptsRef.current >= 1) {
                setRuntimeCode(DEFAULT_SNIPPET);
              }
            } catch (e) {
              if (fixAttemptsRef.current >= 1) {
                setRuntimeCode(DEFAULT_SNIPPET);
              }
            } finally {
              setFixing(false);
            }
          };
          attempt();
        }
      }
    }

    // Set up visibility observer
    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.isIntersecting), { threshold: 0.1 });
    if (mountRef.current) observer.observe(mountRef.current);

    // Handle resize
    const onResize = () => {
      if (!mountRef.current) return;
      const { w: width, h: height } = getSize();
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(mountRef.current);
    window.addEventListener('resize', onResize);

    // Set up Web Worker for syntax-check sandboxing (compile only, no DOM)
    workerRef.current = new Worker(URL.createObjectURL(new Blob([`
      // Minimal globals so user code that references window/document won't throw during compilation
      self.window = self;
      self.document = {
        addEventListener: () => {},
        removeEventListener: () => {},
        body: {},
        createElement: () => ({})
      };
      self.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
      onmessage = (e) => {
        const { gameCode } = e.data;
        try {
          // Only check that the snippet parses as a function body; do not execute
          new Function('THREE', 'scene', 'camera', 'controls', gameCode);
          postMessage({ status: 'compiled' });
        } catch (err) {
          postMessage({ status: 'syntax-error', message: err.message });
        }
      };
    `], { type: 'application/javascript' })));
    workerRef.current.onmessage = (e) => {
      // Report only syntax errors from the compile-checker; ignore runtime issues like missing window
      if (e.data.status === 'syntax-error') setError(e.data.message);
    };
    workerRef.current.postMessage({ gameCode: runtimeCode || gameCode });

    // Set up mobile joysticks
    let moveData, lookData;
    if (isMobile && mountRef.current) {
      const zone = mountRef.current;
      const moveJoystick = nipplejs.create({ zone, mode: 'static', position: { left: '25%', bottom: '25%' }, color: 'blue' });
      const lookJoystick = nipplejs.create({ zone, mode: 'static', position: { right: '25%', bottom: '25%' }, color: 'red' });
      moveJoystick.on('move', (evt, data) => { moveData = data; });
      lookJoystick.on('move', (evt, data) => { lookData = data; });
      moveJoystick.on('end', () => { moveData = null; });
      lookJoystick.on('end', () => { lookData = null; });
    }

    // Animation with FPS throttle and pause
    let lastTime = 0;
    const animate = (time) => {
      requestAnimationFrame(animate);
      if (!isVisible || (time - lastTime < 1000 / 60)) return;
      lastTime = time;
      
      // Apply mobile inputs if present
      if (isMobile && controlsRef.current) {
        if (moveData) {
          // Apply movement based on joystick data
          const speed = 0.1;
          camera.position.x += Math.sin(moveData.angle.radian) * speed * moveData.force;
          camera.position.z += Math.cos(moveData.angle.radian) * speed * moveData.force;
        }
        if (lookData) {
          // Apply look
          try {
            (controlsRef.current as any)?.moveRight?.(lookData.vector.x * 0.1);
            (controlsRef.current as any)?.moveForward?.(-lookData.vector.y * 0.1);
          } catch {}
        }
      }

      // Allow generated code to perform per-frame updates if provided
      if (typeof scene.userData.update === 'function') {
        try {
          scene.userData.update({ time, THREE, scene, camera, controls: controlsRef.current || undefined });
        } catch (e) {
          // Prevent one-off errors from breaking the render loop
        }
      }
      
      renderer.render(scene, camera);
    };
    animate();

    // Cleanup
    return () => {
      observer.disconnect();
      workerRef.current?.terminate();
      // Destroy joysticks
      if (isMobile && mountRef.current) {
        nipplejs.destroyAll();
      }
      mountRef.current?.removeChild(renderer.domElement);
      renderer.dispose();
      controlsRef.current = null;
      resizeObserver.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [gameCode, runtimeCode, isMobile]); // Added runtimeCode to dependency array

  React.useEffect(() => {
    setIsMobile('ontouchstart' in window);
  }, []);

  // Visibility observer to pause iframe rendering when off-screen
  React.useEffect(() => {
    if (!containerRef.current) return;
    const obs = new IntersectionObserver(([entry]) => {
      setIsVisible(entry.isIntersecting);
    }, { threshold: 0.1 });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Track last executed code to prevent duplicate executions
  const lastExecutedCodeRef = React.useRef<string>('');
  
  // Compute the code to pass to iframe - prioritize runtimeCode (set when Play clicked)
  // Include reloadKey in deps to force update when user clicks Play multiple times
  const iframeCode = React.useMemo(() => {
    // When Play is clicked, runtimeCode is set from overlayCode
    // When streaming, streamingCode/displayCode are updated but runtimeCode is empty
    const newCode = runtimeCode || gameCode || '';
    console.log('[GameViewer] iframeCode computed:', {
      hasRuntimeCode: !!runtimeCode,
      hasGameCode: !!gameCode,
      codeLength: newCode.length,
      reloadKey,
      lastExecutedLength: lastExecutedCodeRef.current.length
    });
    // Always update when reloadKey changes (user clicked Play/Restart)
    // This ensures the iframe reloads even if the code is the same
    lastExecutedCodeRef.current = newCode;
    return newCode;
  }, [runtimeCode, gameCode, reloadKey]);
  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        pointerEvents: showOverlay ? 'none' : 'auto'
      }}
    >
      {USE_IFRAME ? (
        <IframeGameViewer
          code={iframeCode}
          panelId={panelId}
          className="w-full h-full"
          visible={!showOverlay}
          reloadKey={reloadKey}
          onStarted={() => { setGameReady(true); }}
          onError={(msg) => { setError(msg); setShowOverlay(true); setGameReady(false); repairAndRetry(String(msg || 'error')); }}
          onGameOver={() => { 
            console.log('[GameViewer] Game Over triggered!'); 
            setGameOver(true); 
            setShowOverlay(false);
            setGameReady(false);
          }}
        />
      ) : (
        <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
      )}

      {/* Removed in-panel controls overlay; floating controls remain near the X button */}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 text-white p-4 z-40">
          <div className="text-sm font-semibold mb-1">Game Error</div>
          <pre className="text-xs mb-2 max-w-[90%] whitespace-pre-wrap">{String(error)}</pre>
          <div className="flex gap-2 mb-2">
            <button
              disabled={fixing}
              onClick={() => repairAndRetry(error || 'Manual retry requested')}
              className="px-2 py-1 bg-white/20 rounded text-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Retry
            </button>
            <button
              disabled={fixing}
              onClick={() => repairAndRetry('User requested regenerate (fresh code attempt)', { mode: 'rewrite' })}
              className="px-2 py-1 bg-white/20 rounded text-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Regenerate
            </button>
            <button onClick={() => setShowOverlay(true)} className="px-2 py-1 bg-white/20 rounded text-sm">View Code</button>
          </div>
          <details className="w-11/12 max-w-[900px]">
            <summary className="cursor-pointer text-xs opacity-80">Show generated code (preview)</summary>
            <pre className="mt-2 max-h-48 overflow-auto text-[11px] w-full bg-black/40 p-2 rounded whitespace-pre-wrap break-all">{runtimeCode || gameCode || streamingCode || thinkingLabel || 'Thinking…'}</pre>
          </details>
        </div>
      )}

      {fixing && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-sm z-40">
          Fixing errors...
        </div>
      )}

      {/* Game Over screen - shown without code overlay */}
      {gameOver && !showOverlay && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm z-50">
          <div className="text-center space-y-6 p-8">
            <div className="text-4xl font-bold text-white mb-4">Game Over</div>
            <div className="flex gap-4">
              <button
                onClick={() => {
                  const raw = displayCode || streamingCode || runtimeCode || gameCode || '';
                  const codeToRun = raw; // sanitizeGameCode(raw); // BYPASSED
                  setRuntimeCode(codeToRun);
                  setDisplayCode(codeToRun);
                  setReloadKey((k) => k + 1);
                  setGameOver(false);
                  setGameReady(true);
                  try { fetch('/api/game/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panelId, stage: 'restart_clicked', message: 'Game restarted' }) }); } catch {}
                  requestAnimationFrame(() => {
                    try { window.dispatchEvent(new Event('resize')); } catch {}
                    const iframe = containerRef.current?.querySelector('iframe') as HTMLIFrameElement;
                    if (iframe && iframe.contentWindow) {
                      try { iframe.contentWindow.postMessage({ type: 'resize' }, '*'); } catch {}
                    }
                    try { document.dispatchEvent(new CustomEvent('hon-iframe-force-reflow', { detail: { panelId } })); } catch {}
                  try { document.dispatchEvent(new CustomEvent('hon-focus-canvas', { detail: { panelId } })); } catch {}
                  });
                }}
                className="px-6 py-2 bg-white/20 hover:bg-white/30 text-white font-medium rounded transition-all"
              >
                Restart
              </button>
              <button
                onClick={() => setShowOverlay(true)}
                className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white font-medium rounded transition-all"
              >
                View Code
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live code overlay (debug/streaming view) + controls */}
      {mounted && showOverlay && (
        <div className="code-overlay" style={{
          position: 'absolute', inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.92)',
          color: '#a7f3d0',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace',
          fontSize: '12px',
          display: 'block',
          zIndex: 10,
          pointerEvents: 'auto'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 14px', borderBottom: '1px solid rgba(16,185,129,0.3)' }}>
            <div style={{ color: '#6ee7b7', fontWeight: 600 }}>{overlayHeading}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                disabled={!hasPlayableCode}
                onClick={() => {
                  if (!hasPlayableCode) return;
                  // Play/Run the current code via the same onRun path
                  const raw = overlayCode;
                  console.log('[GameViewer] Play clicked:', {
                    overlayCodeLength: raw?.length || 0,
                    hasPlayableCode,
                    currentRuntimeCode: runtimeCode?.length || 0,
                  });
                  if (!raw.trim().length) {
                    setShowOverlay(true);
                    setGameReady(false);
                    return;
                  }
                  const codeToRun = raw; // sanitizeGameCode(raw); // BYPASSED
                  console.log('[GameViewer] Setting runtimeCode, length:', codeToRun.length);
                  
                  // IMPORTANT: Increment reloadKey FIRST to ensure iframe re-renders
                  // This fixes the issue where clicking Play after streaming doesn't work
                  const newReloadKey = reloadKey + 1;
                  setReloadKey(newReloadKey);
                  setRuntimeCode(codeToRun);
                  setDisplayCode(codeToRun);
                  setGameOver(false);
                  // Hide overlay immediately so the iframe is visible and interactive
                  setShowOverlay(false);
                  setGameReady(true);
                  try { fetch('/api/game/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panelId, stage: 'play_clicked', message: `len=${codeToRun.length}` }) }); } catch {}
                  try { document.dispatchEvent(new CustomEvent('panel-game-code-run', { detail: { panelId } })); } catch {}
                requestAnimationFrame(() => {
                  try { document.dispatchEvent(new CustomEvent('hon-focus-canvas', { detail: { panelId } })); } catch {}
                  const iframe = containerRef.current?.querySelector('iframe') as HTMLIFrameElement | null;
                  if (iframe) {
                    try { iframe.focus(); } catch {}
                    try { iframe.contentWindow?.postMessage({ type: 'hon-focus-canvas' }, '*'); } catch {}
                  }
                });
                  
                  // Wait for next frame then dispatch resize to trigger WebGL repaint
                  requestAnimationFrame(() => {
                    // Dispatch resize event to window to force WebGL context update
                    try {
                      window.dispatchEvent(new Event('resize'));
                    } catch {}
                    
                    // Also send resize message directly to iframe
                    const iframe = containerRef.current?.querySelector('iframe') as HTMLIFrameElement;
                    if (iframe && iframe.contentWindow) {
                      try {
                        iframe.contentWindow.postMessage({ type: 'resize' }, '*');
                      } catch {}
                    }
                    
                    // Dispatch the force reflow event
                    try { 
                      document.dispatchEvent(new CustomEvent('hon-iframe-force-reflow', { detail: { panelId } })); 
                    } catch {}
                  });
                }}
                style={{
                  padding: '6px 10px',
                  background: 'rgba(16,185,129,0.25)',
                  borderRadius: 6,
                  color: '#e5e7eb',
                  opacity: hasPlayableCode ? 1 : 0.5,
                  cursor: hasPlayableCode ? 'pointer' : 'not-allowed'
                }}
              >{hasPlayableCode ? (gameOver ? 'Restart' : 'Play') : (thinkingLabel || 'Thinking…')}</button>
              <button
                onClick={() => { try { navigator.clipboard.writeText(displayCode || streamingCode || runtimeCode || gameCode || ''); } catch {} }}
                style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.08)', borderRadius: 6, color: '#e5e7eb' }}
              >Copy</button>
              <button
                onClick={() => { setShowOverlay(false); try { fetch('/api/game/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panelId, stage: 'overlay_hidden', message: 'User dismissed overlay' }) }); } catch {} }}
                style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.08)', borderRadius: 6, color: '#e5e7eb' }}
              >Close</button>
            </div>
          </div>
          <div ref={overlayScrollRef} style={{ height: 'calc(100% - 48px)', overflow: 'auto', padding: 14 }}>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, userSelect: 'text', lineHeight: 1.45 }}>
              {overlayCode || thinkingLabel || 'Thinking…'}
            </pre>
          </div>
        </div>
      )}

      {/* Minimal floating controls, only when game is ready */}
      {gameReady && (
        <div className="absolute -top-8 right-2 z-20">
          <div className="inline-flex items-center gap-2 px-2 py-1 rounded bg-black/70 text-white text-[11px]">
            <span>WASD Move</span>
            <span>Mouse Look</span>
            <span>Click Shoot</span>
          </div>
        </div>
      )}
    </div>
  );
};
