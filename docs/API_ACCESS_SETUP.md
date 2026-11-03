# Private experiment API access

The canvas API is for explicitly allowed users. It is not an unrestricted public generation service. The shared Vercel routing middleware covers every `/api/*` route, including model calls, Hume token minting, upload/export routes, proxies, status checks, and tool logs. The local Express server applies the same check before parsing uploads or dispatching tools.

Set `HON_API_ALLOWED_USER_IDS` to exact Supabase user UUIDs and/or Privy DIDs, separated by commas. The server verifies the provider token before checking this list. A wallet address or a profile ID supplied by the browser is not authentication.

Supabase verification uses `SUPABASE_URL` and a **public** authentication API key: `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY`, or the existing `VITE_SUPABASE_ANON_KEY`. It calls the project's Auth server to verify the user. Identity verification itself does not need service-role authority. The separate request-budget ledger below uses a server-only service credential. Privy verification uses `PRIVY_APP_ID` and the pinned `PRIVY_VERIFICATION_KEY` described in `SPLAT_SECURITY_SETUP.md`. The SHARP and media paths retain their additional allowlists and storage requirements.

Set `HON_APP_ORIGIN` to the app's exact origin, for example `https://canvas.example`. Each deployment must use its own correct origin. Missing configuration fails closed. Browser requests from other origins, including opaque generated game frames, are rejected. The frontend attaches provider proof only to its own API calls. It does not attach that proof to auth providers, model media, or other third-party URLs. Streaming responses and request bodies are passed through without buffering or retrying paid work.

## Internal tool calls

Set `HON_INTERNAL_API_ORIGIN` when an internal caller needs a canonical app origin. Otherwise Vercel's own `VERCEL_URL` is used; local development uses loopback. Internal repair, scene execution, mask conversion, and ZIP calls forward only the user's bearer proof and JSON content type. They do not construct a destination from a request's Host or Origin, forward provider cookies, or follow redirects.

## Google and Notion connections

These integrations need `HON_OAUTH_STATE_SECRET`, a server-only random value of at least 32 bytes. Do not put it in a `VITE_*` variable or Git. Rotating it invalidates existing state and provider cookies.

Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`; the callback must be this app's `/api/google/callback`. For Notion, configure `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`, and `NOTION_MCP_REDIRECT_URI` ending in `/api/notion/mcp-callback`. Register those exact URLs with the existing providers. No redirect URL is inferred from a request header. Use HTTPS in production and match the popup opener's app origin. Local HTTP callbacks are limited to loopback development.

Connection starts now use authenticated POST requests. They return an authorization URL to an already-open popup. The callback requires a signed, ten-minute state cookie and matching nonce; invalid state stops before a token exchange. State is cleared after a valid browser flow. Provider authorization codes remain subject to the provider's single-use rules.

Provider cookies are HttpOnly, signed, subject-bound, and expire after seven days. Production cookies use the `__Host-` prefix, Secure, and Path=/ without Domain. They are signed, not encrypted. Existing unsigned Google/Notion cookies are not accepted, so reconnect those integrations once. API access still requires the independently verified user token; a provider cookie is not a substitute. Popup completion messages must come from the expected popup and the app's own origin. Provider text is escaped before being placed in callback HTML.

Veo completion already uses authenticated status polling. The old callback only acknowledged receipt and did not save results. New requests no longer register that public no-op callback or send a webhook secret in its URL. Useful provider callbacks need a separate signature/ownership design.

## Validation and rollout

The security regressions use fake provider responses and generated test signing keys. They cover route denial, Supabase/Privy verification, state tampering and expiry, provider-cookie binding, internal destinations, popup context, token forwarding, and SSE/body preservation. They do not call paid models, perform a real OAuth login, apply database changes, or deploy a worker.

Before any production rollout, configure the allowlists and public verification settings in a separate test deployment, reconnect Google/Notion, and check a real sign-in, a speech session, an image/tool call, and an export. Check anonymous API requests while already past any outer Vercel preview login. A preview's Vercel login alone does not prove this application's access check works. Roll out the server and client together; do not remove the check to work around missing configuration.

Database RPC ownership/grants, multi-user resource isolation, provider quotas, saved-scene signed-URL refresh, historical keys, and remaining dependency advisories are separate unfinished work. This change does not approve publication or secure old deployments automatically.

The routing helper is pinned to Vercel Functions 3.6.1. Its `next()` interface was checked in the official package; newer 3.10.5 introduced a vulnerable CLI/OIDC dependency chain in the audit. CI verifies the helper and bundles the gateway. This pin is not a claim that the rest of the dependency tree is clean.

Every deployed Node API entrypoint also calls the shared verifier before its handler runs. The routing proxy is an additional check, not the only access boundary. API paths use normal filesystem routing; only non-API paths fall back to the canvas page.

## Shared request budget

Apply `migrations/api_request_budget.sql` before enabling API work. Set the existing server-only Supabase service credential and `HON_API_MUTATIONS_PER_HOUR` (1–10000, default 60). An atomic database counter caps each verified user's mutation requests per UTC database hour across server instances. Exhaustion returns 429; missing/failed configuration returns 503 before the handler. GET/HEAD/status polling have a separate atomic cap, `HON_API_READS_PER_HOUR` (default 600, same 1–10000 range), so polling does not consume mutation slots. OPTIONS consumes neither. Internal POSTs consume slots too. This is a request cap, not a provider dollar budget; providers still need their own spending limits. Counters can be periodically deleted by the service role after the desired audit-retention period.

Paid generation jobs have a second, smaller cap: `HON_API_PAID_JOBS_PER_HOUR` (1–9999, default 20) per verified user per hour. It counts POSTs to the routes listed in `api/_lib/paid-routes.js` (image, video, audio, 3D and splat jobs) in the same ledger under a `paid:` key, so it needs no extra migration. When it is reached the API returns 429 with `code: "paid_job_limit"` and a `Retry-After` header. It counts jobs, not money; set a spending limit with each provider as well.

Apply `migrations/secure_canvas_history.sql` last, after legacy history migrations. It replaces wallet-string RLS shortcuts, derives history ownership from `auth.uid()`, makes functions use caller privileges, pins search paths, revokes old overloads, and keeps browser reads/writes to the owner's rows. History requires a real Supabase database session. A Privy UI identity or wallet alone does not establish that session; this candidate does not silently map it to another user's history. Unowned legacy rows remain inaccessible pending a verified migration. The SQL does not change production data until an operator applies it.

Upload and export sources use `HON_MEDIA_DOWNLOAD_HOSTS`, the same exact approved-host configuration as downloads. Upload inputs accept bounded media data, not server paths. Remote exports/animation use approved HTTPS assets, no redirects, 30-second reads and 32 MiB per asset. Exports accept at most eight assets. Keep this host list narrow and operator-controlled.

ElevenLabs speech uses the server-only `ELEVENLABS_API_KEY` through the protected API. Do not set `VITE_ELEVEN_LABS_API_KEY` or put provider credentials into a browser build. Pika reference images use the protected media-upload route; there is no embedded upload-key fallback.
