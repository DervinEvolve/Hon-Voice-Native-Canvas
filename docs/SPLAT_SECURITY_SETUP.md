# SHARP and LOD security setup

This is a private draft for the `infinite-scene-agents` canvas branch. Do not deploy it over an existing service until the database, worker, frontend, and storage changes are ready together.

## Identity and job access

The API accepts a Bearer access token from Supabase or Privy. Supabase tokens are verified using `auth.getUser`. Privy tokens are verified with `jose`, pinned to ES256, the configured app ID, issuer `privy.io`, and the app's public verification key. A UI user ID, request body owner ID, or connected wallet alone is not proof of identity.

Set these on the Vercel server:

- `SUPABASE_URL` (or the existing public `VITE_SUPABASE_URL` alias).
- `SUPABASE_SECRET_KEY` (preferred), or the older `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SERVICE_KEY`. There is no anon-key fallback.
- `HON_SPLAT_ALLOWED_USER_IDS`: comma-separated verified Supabase user IDs and/or Privy DIDs permitted to use this personal experiment. An empty list disables processing. Privy storage/database owners use a stable server-derived hash of the DID.
- For Privy: `PRIVY_APP_ID` (or `VITE_PRIVY_APP_ID`) and `PRIVY_VERIFICATION_KEY`, the app's public SPKI verification key. This is a public verification key, not a client secret. Review key rotation when updating it.
- `HON_SPLAT_IMAGE_HOSTS`: exact HTTPS source hostnames. No wildcard matching. The Supabase storage hostname is also accepted by the Vercel client. Configure only hosts you control or trust; the host allowlist is the remote-fetch boundary.

Apply `migrations/secure_sharp_jobs.sql` in a test database first. It restricts the old incorrectly named public RLS policy to `service_role`, removes browser-role table grants, adds owners and private storage paths, and creates a private `hon-private-splats` bucket. Review existing `storage.objects` policies separately; a private bucket flag does not repair unrelated broad policies. Existing unowned jobs and public files are not automatically assigned, moved, or deleted.

New results are stored under the verified owner's path. Status and result reads filter by both job ID and owner. Result GET signs an existing private file for five minutes; it never uploads legacy base64 data or returns an old public URL. New canvas scenes persist the SHARP job ID and request a fresh owner-checked URL when the immersive viewer opens or switches scenes. The viewer does not fall back to the saved URL for those jobs. Legacy scenes without a job ID need a verified migration or regeneration. A connected storage/rendering check remains a rollout requirement.

## Modal worker

Deploy `modal/sharp_splat.py` with proxy authentication required. Create a dedicated Modal web Proxy Token and configure its pair as `MODAL_SHARP_PROXY_KEY` and `MODAL_SHARP_PROXY_SECRET` on Vercel, along with the explicit `MODAL_SHARP_ENDPOINT`. Do not reuse `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, or other workspace/account tokens for the web call.

The worker reads exact approved image hostnames from `HON_SPLAT_IMAGE_HOSTS` in the Modal secret `hon-sharp-config`. Include the project's Supabase storage hostname there when it is an image source. Redirects are rejected, images are limited to 20 MiB, and generated PLY output is limited to 128 MiB. The worker is capped at one container. This limits concurrency, not total spend; provider budgets and per-user job quotas remain required before multi-user use.

The image build pins ml-sharp to one commit and installs that commit's dependency lock. It verifies the checkpoint against `SHARP_CHECKPOINT_SHA256` and stops while that value is empty. Steps, licenses and limits are in [modal/README.md](../modal/README.md).

See [Modal Proxy Tokens](https://modal.com/docs/guide/webhook-proxy-auth) and [Privy access tokens](https://docs.privy.io/authentication/user-authentication/access-tokens).

## LOD output

LOD processing uses the same verified identity and allowlist. It downloads only an HTTPS public `hon-assets` object from this project's storage, without redirects, and caps the input. Scene IDs have a restricted character set. Temporary paths are generated independently of request data. Both converter invocations use `execFileSync` argument arrays with no shell.

The existing multi-file LOD format still publishes files into the public `hon-assets` bucket. It therefore requires explicit `HON_ALLOW_PUBLIC_LOD_OUTPUT=true`. Outputs are namespaced by verified owner. Keep it unset for private scenes until authenticated multi-file delivery is implemented. This switch does not affect the private SHARP image-to-splat path.

## Validation and limits

Seven Node test groups import the real API handlers with only the external Supabase SDK stubbed. They cover anonymous rejection, verified allowlists, forged/expired/wrong-app Privy tokens, unsafe scene IDs, response bounds, owner predicates, private bucket checks, and a complete stubbed worker-to-private-storage submission. Two FastAPI tests load the actual worker function without Modal deployment objects and check remote URL restrictions, redirects, and size rejection before inference. No paid inference or live database call is made.

Run `node --test tests/splat-security.test.mjs` after `npm ci --ignore-scripts --legacy-peer-deps`, and run `python -m unittest discover -s tests -p 'test_sharp_worker_security.py'` with FastAPI installed. Both run in CI.

These tests do not establish a working deployment or a full frontend build. Remaining checks include Privy/Supabase sign-in in the real canvas, saved-scene URL refresh, migration grants and storage policies, unauthorized requests to both deployed layers, real converter compatibility, quotas, and the rest of the app's generation/proxy/OAuth routes. This is not clearance to publish or expose the service.
