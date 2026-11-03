## Game Generation Architecture

This document describes the end‑to‑end flow for Hon’s interactive 3D game panels. Use it when you need to debug generation failures, extend the prompts, or port the implementation.

---

### High-Level Flow

1. **Tool request** – Hon (through `HumeEviService`) receives a `generate_game` tool call and POSTs to `/api/game/generate-stream` with the user’s description and any custom GLB assets.
2. **Server orchestration** – `/api/game/generate-stream` hits Gemini 3 Pro Preview (direct Google API) via `requestStructuredGeminiGame`. We request up to two structured JSON attempts. Only after both attempts fail do we fall back to Claude, and the template is used strictly as the last-resort safety net when Claude/repair cannot produce playable code.
3. **Streaming to client** – Even though Gemini is called via a blocking JSON request, we chunk the validated code into ~900 char slices and emit them as `delta` events so the Creator overlay still shows live streaming. When the final slice is sent we emit a `done` event with metadata about the source (`ai`, `ai-repaired`, or `template`).
4. **Panel runtime** – `GameViewer` listens for the streamed code, displays progress, and hands the code to `IframeGameViewer`, which runs it inside a sandboxed `<iframe>` where the actual Three.js scene lives.
5. **Gameplay loop** – The iframe injects our baseline environment (lights, inputs, HUD mounting point) and calls the generated `scene.userData.update` every frame. When the game ends, the iframe posts a `hon-game-over` event which `GameViewer` uses to show the Restart/View Code overlay.

---

### Server-Side Components

| File | Responsibility |
| --- | --- |
| `api/game/generate-stream.js` | Primary SSE endpoint used by Hon during live collaboration. Handles Gemini → Claude → template fallbacks, validation, repair, and streaming status updates. |
| `api/game/generate.js` | Non-streaming fallback/utility endpoint (same logic as above but returns JSON). |
| `src/lib/gemini3StructuredRequest.js` | Helper that calls Gemini 3 Pro Preview directly via Google’s REST API. It enforces the JSON schema (including the optional `thought_process` field), retries once on parse failure, and hands the spec to `gemini3GameBuilder`. |
| `src/lib/gemini3GamePrompts.js` | Contains the strict system prompt and user prompt for Gemini plus schema instructions. Also reused by the structured helper. |
| `src/lib/gemini3GameBuilder.js` | Translates the JSON spec (`metadata`, `setup`, `update`, `hud`, etc.) into a single self-contained JS snippet. Injects Hon’s HUD root, deterministic RNG, `finishGame` helper, and cleans up DOM nodes on restart. |
| `src/lib/validateGame.js` | Shared validation utilities (undefined variables, missing `scene.userData.update`, etc.). Called before we hand code back to the client. |
| `src/lib/gameTemplates.js` | Contains the deterministic fallback templates (e.g., cone dodger). Used when both Gemini and Claude fail. |

**Error Handling**

1. Gemini returns invalid JSON → logged, auto-retried once via `requestStructuredGeminiGame`.
2. Gemini retries exhausted → we log and switch to Claude while still streaming status back to the client.
3. Validation errors → attempt auto-repair (Claude) before falling back to template.
4. Any fatal exception before streaming starts → respond with 500; the frontend catches the failure and uses template (already shipped).

---

### Frontend Components

| File | Responsibility |
| --- | --- |
| `src/services/humeEviService.ts` | Orchestrates tool calls, dispatches `/api/game/generate-stream`, and streams SSE messages into the app store (`panel-game-code-delta`, `panel-game-code-run`, etc.). |
| `src/components/media/GameViewer.tsx` | React shell for each game panel. Shows the streaming overlay, handles “Play / Copy / Close”, exposes `Retry`/`Regenerate`, and owns the Restart/View Code overlay when the iframe signals `hon-game-over`. |
| `src/components/media/IframeGameViewer.tsx` | Builds the sandboxed `<iframe>` HTML/JS. Provides default lighting, input capture, pointer lock, HUD mounting, deterministic RNG, and calls the user’s `scene.userData.update`. Detects errors, sets `scene.userData.gameOver`, and posts `hon-game-over` events to the parent. |

**Lifecycle inside GameViewer**

1. **Streaming overlay** – `GameViewer` collects SSE deltas into `streamingCode` + `displayCode`. When the user hits Play (or when Hon auto-executes), it runs the latest code through a syntax check (`new Function`) before storing it in state.
2. **Iframe reloads** – `IframeGameViewer` receives `code` and `reloadKey`. It rebuilds an `srcDoc` that includes the baseline scene, the user code, and our watchdog wrappers (`stripDanglingIdentifiers`, lighting checks, etc.).
3. **Game Over / Restart** – When the iframe dispatches `hon-game-over`, `GameViewer` sets `gameOver` and shows the Restart overlay while keeping the canvas hidden. Restart simply replays the stored code, ensuring hot restarts are instant.
4. **Error surfaces** – Syntax/runtime errors in the iframe post `hon-game-error` which `GameViewer` shows in the overlay with Retry/Regenerate buttons tied to `/api/game/repair`.

---

### Event/Message Glossary

| Event | Source → Target | Purpose |
| --- | --- | --- |
| `panel-game-code-delta` | `HumeEviService` → `document` | Raw text chunk from SSE. GameViewer appends to buffers. |
| `panel-game-code-run` | `GameViewer` → `document` | Signals GameViewer has pushed new code to iframe (used to dedupe). |
| `hon-focus-canvas` | Parent → iframe | Forces focus/pointer lock to guarantee WASD works after reload. |
| `hon-game-error` | iframe → parent | Serious runtime error; parent shows Retry/Regenerate overlay. |
| `hon-game-started` | iframe → parent | Sent when user code created extra objects; used to hide overlay. |
| `hon-game-over` | iframe → parent | Emitted when `finishGame()` is called or `scene.userData.gameOver` flips. Parent shows Restart overlay. |

---

### Key Behaviors to Remember

- **Game state contract:** `gemini3GameBuilder` now instantiates `const game = { state: {}, objects: {}, metadata }` and injects it into every block. Gemini must store ALL meshes under `game.objects.*` and scalar progress under `game.state.*`. Cleanup automatically disposes anything registered on `game.objects`.
- **Deterministic RNG:** The builder adds an `rng()` helper seeded per load so Gemini games can rely on deterministic loops.
- **HUD DOM ownership:** The builder injects HUD HTML/CSS into `hudRoot` and cleans it up inside `scene.userData.cleanup`. This prevents duplicate overlays between restarts.
- **Input contract:** `IframeGameViewer` still forwards `(deltaTime, input)` to legacy templates but also passes a context object containing `game`, `state`, `objects`, and the pointer-lock-aware input. Gemini prompts explicitly forbid `addEventListener` and OrbitControls.
- **Fallback template hooks:** Even the template code sets `scene.userData.gameOver` so the Hon overlay logic remains consistent regardless of source.

---

### Debug Tips

1. **Check Vercel logs** – Look for `[game.generate-stream]` entries. Each panel logs `requestId` plus the panel ID; use those to trace which stage failed (Gemini attempt, Claude fallback, validation).
2. **Inspect SSE payloads** – The browser console logs `[generate_game] Delta received...` showing total length; use this to confirm you’re receiving Gemini code vs template length (~4.5k for dodger).
3. **Iframe console** – `IframeGameViewer` prints the first 500 chars and logs whenever `scene.userData.update` executes; if you don’t see “Animation loop running,” the user code failed early.
4. **HUD duplication** – If you ever see multiple HUDs, verify `scene.userData.cleanup` removes DOM nodes. Gemini code should call `finishGame` instead of manually toggling overlays.

This covers every file that touches game generation. With it, you can trace any failure from prompt to renderer and swap out components as needed. Let me know if you want diagrams or flow charts added. 

