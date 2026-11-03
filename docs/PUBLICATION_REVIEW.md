# Canvas source review

The public repository starts from a clean snapshot of the canvas experiment developed on `infinite-scene-agents`. The original website, private branches, preparation commits, historical credentials and unconfirmed media stay in the private repositories and backups.

## Published checks

[Public CI run 41659465601](https://github.com/DervinEvolve/Hon-Voice-Native-Canvas/actions/runs/41659465601) passed on the initial public snapshot:

- Exact-lockfile installation with lifecycle scripts disabled.
- All 210 Node security and integration regressions.
- API routing helper and gateway bundle checks.
- Disposable PostgreSQL tests for ownership, anonymous and cross-user denial, policy migrations, rollbacks and atomic request limits.
- Three SHARP worker tests covering URL, redirect, size, commit and checkpoint restrictions.
- The Vite canvas build.

The public repository has secret scanning, push protection, Dependabot and private vulnerability reporting enabled. Main requires the canvas check and blocks force pushes and deletion. Actions are limited to the two pinned official actions used by the workflow. These tests use simulated providers and disposable databases.

The fresh publication snapshot and public clone had zero Gitleaks findings. The source starts with the author's GitHub noreply identity. The original and private review histories remain private.

## Access and execution

API routes require provider-verified Supabase or Privy identity and an explicit allowed-user list. Missing configuration denies access. Read, write and paid-job limits use atomic database counters. The default paid-job limit is 20 per user per hour.

Async provider jobs carry owner-bound signed tokens. Status and result routes check those tokens before contacting the provider. SHARP jobs use owner-scoped IDs, private storage and expiring result URLs. The worker requires proxy authorization and limits the source hosts and data sizes.

Google and Notion connections start with authenticated requests. Callbacks check signed, expiring state. Provider cookies are signed, subject-bound and HttpOnly. Internal calls forward identity proof only to configured app origins.

The canvas-history migrations use verified database identity and owner policies. A wallet connection or Privy UI identity alone does not create a Supabase database session. The approved protection transaction on the existing database completed; ten independent catalog checks passed, with existing data and trigger attachments retained.

## Assets and licenses

The 44 credited CC-BY-4.0 models are optional Release downloads. The source clone contains their catalog, attribution records and SHA-256 manifest. Both model packs include the complete credit documents. Packaging checks every model's size and hash against the approved original bytes. Eighteen unconfirmed or restricted models are excluded.

MIT covers original integration code. PlayCanvas's adapted radial-reveal example has its full upstream MIT notice under `docs/licenses/`. The author confirmed the Codevre demo was a visual reference. Apple's SHARP software and weights retain their own terms; weights are downloaded separately and excluded from the model packs. [Third-party notices](../THIRD_PARTY_NOTICES.md) records the details.

## Remaining work

- The production dependency audit reports 27 findings: 15 high, 3 moderate and 9 low. Compatible fixes are applied. The remaining auth, wallet and voice SDK constraints are recorded in [the dependency review](DEPENDENCY_REVIEW.md).
- Full app/server type checks and lint still fail; the README records the current counts. The passing build checks bundling.
- The voice scene builder runs generated code with the signed-in page's privileges when explicitly enabled. Both browser and server switches default off. Moving it into an isolated frame is unfinished. Generated games already use a separate opaque-origin frame.
- Voice tools can start paid jobs and external writes without per-job confirmation. The hourly job cap needs provider spending limits alongside it.
- Sign-in, speech, connected provider jobs, storage and asset rendering need testing with real configured accounts. The EVI prompt and tool configuration still needs an export.
- The page policy retains inline script/eval and broad HTTPS media permissions for current integrations. Browser checks across the connected features remain unfinished.
- This SHARP path accepts images. The separate video/frame-to-splat workflow still needs tracing and extraction.

## Hosting and historical credentials

This source publication creates no hosted canvas or demo link. The existing placeholder, protected preview, production API restrictions and Git auto-deployment hold are unchanged.

Historical key retirement is recorded privately per provider. Some old provider credentials remain unverified. Their historical files and commits are excluded from the public source, and the original repositories stay private. Replacement keys belong in private server configuration.
