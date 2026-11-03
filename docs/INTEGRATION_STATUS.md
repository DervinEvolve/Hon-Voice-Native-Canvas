# Integration status

Which voice tools and app features have something behind them in this repository, what each needs, and which ones are not available. "Available" means the code path exists and works once its provider key or setup is in place; it does not mean it has been tested end to end (see the README limitations). Every `/api` route also needs the sign-in and allowlist in [API_ACCESS_SETUP.md](API_ACCESS_SETUP.md).

Unavailable features answer plainly: voice tools send the model a `tool_error` with a one-sentence reason and Hon says it aloud; server routes answer `501` with `{ "code": "not_available", "error": "…" }` (`api/_lib/not-available.js`). `tests/unavailable-integrations.test.mjs` checks that every `/api` path the browser calls has a deployed function.

## Voice tools

The tool definitions live in the Hume EVI configuration (not in this repository). These are the names `src/services/humeEviService.ts` handles; any other name gets "Tool not implemented".

| Tool | Status | What it calls | Needs |
|---|---|---|---|
| `getCanvasState`, `arrange_panels`, `find_similar_panels`, `highlight_objects` | Available | Canvas state in the browser | Nothing beyond the voice session |
| `get_panel_vision` | Available | `/api/fal/isaac-stream` | `FAL_API_KEY` |
| `create_mood_board` | Available | `/api/fal/openrouter-vision`, `/api/fal/seedream-edit` | `FAL_API_KEY` |
| `seedream_reference_generate` | Available | `/api/fal/seedream-edit` | `FAL_API_KEY` |
| `canvas_editor_tool` | Available | `/api/flux/krea`, `/api/fal/nano-banana`, `/api/fal/nano-banana-edit` | `FAL_API_KEY` |
| `video_generator` | Available | `/api/seedance/text-to-video`, `/api/veo31/image-to-video` and their status routes | `FAL_API_KEY`; Veo 3.1 also needs `HON_JOB_ID_SECRET` (or `HON_OAUTH_STATE_SECRET`) |
| `aleph_video_editor` | Available | `/api/fal/lucy-edit` and status routes | `FAL_API_KEY` |
| `getVideoContext` | Available | `/api/fal/video-understanding` | `FAL_API_KEY` |
| `add_sound_effects` | Available | `/api/sfx/submit`, `/api/sfx/status`, `/api/sfx/mux` | `FAL_API_KEY`; Cloudinary account for the mux step |
| `text_to_3d` | Available | `/api/fal/meshy-text-to-3d` and status routes | `FAL_API_KEY` |
| `place_3d_model_on_map` | **Not available** | Would need `/api/proxy-model`, which this build does not include | Answers before starting any 3D job. Switch: `MAP_MODEL_PLACEMENT_AVAILABLE` in `src/config/unavailableFeatures.ts` |
| `world_mode` | Available | `/api/world/geocode`, Google Maps 3D in the browser | `GOOGLE_MAPS_SERVER_KEY` and a browser Maps key |
| `generate_world_scene` | **Not available** (prompt-to-world); map branch available | In map mode it opens a real place like `world_mode`. Otherwise it answers "not available"; `/api/luma/generate-scene` answers `501` | It no longer returns sample captures |
| `generate_3d_splat` | Available after setup | `/api/sharp/submit`, `/status`, `/result` → Modal SHARP worker | Modal worker, proxy token, private Supabase storage ([SPLAT_SECURITY_SETUP.md](SPLAT_SECURITY_SETUP.md)) |
| `immersive_add_object`, `immersive_spawn_npcs`, `pc_*` scene tools (not `pc_execute`) | Available | PlayCanvas in the browser, the 44 built-in models | Git LFS payloads or `VITE_3D_ASSET_BASE_URL` |
| `pc_execute` and the `pc_*` script tools | **Off by default** | `/api/playcanvas/execute` (and `execute-subtask`, `parallel-execute`) | `ANTHROPIC_API_KEY` plus both `VITE_ENABLE_SCENE_CODE_EXECUTION=true` and `HON_ENABLE_SCENE_CODE_EXECUTION=true`; otherwise the tool answers with an error and the routes return `403 scene_code_disabled` |
| `generate_game`, `edit_game`, `set_game_model` | Available | `/api/game/generate-stream`, `/api/game/generate-template`, `/api/game/edit`, `/api/game/log` | `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` |
| `take_notes`, `stop_notes`, `summarize_to_notion`, `notion_action` | Available after setup | `/api/notion/*` | Notion OAuth client, `HON_OAUTH_STATE_SECRET`; `notion_action` also `ANTHROPIC_API_KEY` |
| `add_notion_note` | Available | Notes panel; `/api/notion/save` when a Notion page is connected | The tool result says whether the note reached Notion |
| `memory_put`, `memory_get`, `memory_search`, `memory_delete`, `session_upsert`, `session_get` | **Needs tables that have no migration here** | Supabase tables `hon_memories`, `hon_sessions` | Until those tables exist the tools return the database error to the model |

## App features outside the voice tools

| Feature | Status | Notes |
|---|---|---|
| Speech-to-speech (Hume EVI) | Available after setup | `HUME_API_KEY`, `HUME_SECRET_KEY`, `HUME_CONFIG_ID` and an EVI config with Hon's tools (not in this repository) |
| Creator panels for individual providers (Flux, Luma, Runway, Kling, Pika, Minimax, Vidu, Wan, Marey, Sora 2, Veo, Higgsfield, Ideogram, Recraft, Bria, Easel, Dreamina, Hunyuan, ElevenLabs, Hume TTS and others under `api/`) | Available with each provider's key | Each route reads its own key (`.env.example`). Higgsfield presets show names only; their hosted preview images are not bundled |
| Kling 2.1 image-to-video through fal.ai | **Local dev server only** | `/api/fal/kling-image-to-video` exists only in `src/server/api.ts`; a deployed build shows a message saying so |
| Virtual try-on (panel editor) | **Not available** | No try-on provider is connected; the tab is labelled "(not available)" and the button says so |
| ElevenLabs voice list (`/api/elevenlabs/voices`) | **Not available** | Answers `501`; speech synthesis (`/api/elevenlabs/tts`) is separate |
| ElevenLabs Conversational AI widget | **Not available** | The page script policy does not allow its script host and no agent is configured; the component renders nothing |
| Roboflow SAM3 detection (`/api/roboflow/sam3-detect`) | Available with `ROBOFLOW_API_KEY` | Returns `503` when unset and `502`/`500` on provider errors, instead of "no objects" |
| Export images and zip | Available | No image proxy: an image the browser cannot read exports as an "Image unavailable" placeholder |
| Collaboration (collaborators, invites, presence) | **Needs tables that have no migration here** | Needs a Supabase session and the `collaborators`, `collaboration_invites` and `profiles` tables; without them reads are empty and writes fail with a plain reason. No sample collaborators are shown |
| Saved canvas history | Available after setup | `migrations/secure_canvas_history.sql` and a Supabase database session |
| Weapons, ammo, FPS arm rigs, gun cases, military truck, second robot, bird | **Not in this build** | Excluded for unverified provenance (`docs/PRIVATE_ASSET_QUARANTINE.json`). Loading is skipped (`WEAPON_MODELS_AVAILABLE` in `src/lib/playcanvas/assetAvailability.ts`); the scene prompts no longer offer them |
| External animation library | Off unless configured | `VITE_ANIMATION_LIBRARY_URL`, pointing at a library with verified redistribution terms. Characters otherwise play their built-in clips |
| Wallet, subscriptions and creator support (Solana) | Code from the earlier comic app; not part of the canvas experiment | Not audited in this list |
