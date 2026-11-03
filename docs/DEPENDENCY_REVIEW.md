# Production dependency review

Scope: `npm audit --omit=dev --package-lock-only` with the repository `.npmrc`
(`legacy-peer-deps=true`). Without that `.npmrc` npm also counts peer
dependencies, and the same lockfile reports 55 findings rather than 36, so
always audit from the repository root.

| | low | moderate | high | total |
|---|---:|---:|---:|---:|
| Before (`f132a55`) | 9 | 12 | 15 | 36 |
| After this branch | 9 | 3 | 15 | 27 |

## Changed on this branch

| Advisory root | Change | Evidence |
|---|---|---|
| `stream-json` 1.9.1 (GHSA-mjw6-4jj6-33hc, GHSA-hqr4-qq8f-hg3x, GHSA-528h-pc64-c93x) through `@solana/web3.js` 1.99.0 -> `jayson` 4.3.0 | Scoped override `"@solana/web3.js": { "jayson": "5.0.0" }`. jayson 5 drops `stream-json` and `uuid`. | web3.js imports only `jayson/lib/client/browser`, which differs between 4.3.0 and 5.0.0 only in request id generation (`crypto.randomUUID` with a `getRandomValues` fallback instead of `uuid.v4`). The jayson 5 breaking changes are in its TCP/TLS transports, which web3.js does not load. `tests/solana-rpc-client.test.mjs` covers single and batch calls. |
| `minimatch` 5.1.9 / 3.1.5 (GHSA-g3hv-75wg-m249, patched >=11.0.1) through `archiver` 5.3.2 | `archiver` removed and `/api/export/zip` now uses `jszip` (already a dependency). | No archiver release clears it: 7.0.1 keeps `readdir-glob` ^1 (minimatch ^5) and `archiver-utils` ^5 (glob ^10, flagged by GHSA-3g3m-2fjr-6pw4); 8.0.0 is ESM-only with a new class API and keeps `readdir-glob` ^3 -> minimatch ^10.2.2. Overriding minimatch to 11 would cross the major every dependent declares. `tests/export-zip.test.mjs` passed against archiver before the swap and against jszip after it. |

If the jayson override is ever removed, or `@solana/web3.js` moves to a release
that declares jayson 5 itself, delete the override and keep the test.

## Still open

### `zod` <4.6.6 (GHSA-mrhx-c7xc-m3w5, high, 15 findings)

Only zod 4.6.6 and later are patched. There is no fixed 3.x release.

| Consumer | zod it requires | Newer release on zod 4? |
|---|---|---|
| `hume` 0.10.3 | ^3.23.8 | No. Every release up to 0.16.1 (latest) declares ^3.23.8. |
| `@privy-io/react-auth` 2.25.0 (latest 2.x) -> `@privy-io/api-base` 1.7.0, `@privy-io/public-api` 2.45.0 | 3.25.76 | No. 3.51.0 still ships `@privy-io/api-base` 1.12.0 on zod 3. |
| `@reown/appkit-wallet` 1.8.24 / 1.7.8 (through Privy and `@walletconnect/ethereum-provider`) | pinned 3.22.4 | Not within the versions Privy allows. |
| `@coinbase/cdp-sdk` 1.60.0, `abitype` (through viem / `@base-org/account`) | 3.x | Not within the versions their dependents allow. |
| `@anthropic-ai/sdk` 0.67.0, `@anthropic-ai/claude-agent-sdk` 0.1.22 | 3.25.76 (peer, not counted by the audit because of `legacy-peer-deps`) | Not reviewed here. |

The application code does not import zod directly. An override to zod 4 is not
acceptable: hume, Privy and Reown run their own zod 3 schemas, and zod 4
changes the API and error shapes. This finding stays open until hume and Privy
release versions built on zod 4. Check `npm view hume dependencies` and
`npm view @privy-io/react-auth dependencies` on each release.

### `uuid` <11.1.1 (GHSA-w5hq-g745-h8pq, moderate, 3 findings)

Remaining paths: `@privy-io/react-auth` 2.25.0 and `@privy-io/js-sdk-core`
0.55.0 (`uuid` ">=8 <10"), `@solflare-wallet/sdk` 1.4.2 (latest, ^9.0.0) through
`@solana/wallet-adapter-solflare` 0.6.34 (latest), and `hume` 0.10.3 (pinned
9.0.1). The advisory affects `v3`/`v5`/`v6` when a `buf` argument is passed.
Every one of these consumers imports only `v4`, so the vulnerable functions are
not reached on these paths. That is a reachability note, not a fix. No
dependent range accepts uuid 11, so an override would cross a major in four
packages. `hume` 0.16.1 drops uuid, but Privy and Solflare still pull it in, so
moving hume would not clear the finding (see below).

### `elliptic` <=6.6.1 (GHSA-848j-6mx2-7j84, low, 9 findings)

Chain: `@privy-io/react-auth` 2.25.0 -> `@privy-io/js-sdk-core` 0.55.0 (pinned)
-> `@ethersproject/*` 5.8.0 (latest v5) -> `elliptic` 6.6.1. 6.6.1 is the newest
elliptic release, so no version is patched. The only way to clear this is
Privy 3, which drops the ethers v5 chain.

## Privy 3 migration plan (not done on this branch)

Effect measured with a lockfile-only install of `@privy-io/react-auth@3.51.0`
on top of this branch: 27 -> 25 findings. Low goes from 9 to 0 (elliptic
cleared), moderate goes from 3 to 9 and high from 15 to 16. 3.51.0 adds `x402`
-> `wagmi` -> `@metamask/*` and `@gemini-wallet/core`, which bring uuid 9 and
zod 3 back in. The net security gain is one low-severity advisory, in exchange
for a major auth SDK migration.

Code that would change:

1. `src/main.tsx`: the `PrivyProvider` config. In 3.x `externalWallets.solana`
   accepts only `{ connectors }`, built with `toSolanaWalletConnectors()` from
   `@privy-io/react-auth/solana`. The current
   `{ providers: ['phantom','backpack'], options: { cluster } }` block (already
   under `@ts-ignore`) has to be rewritten, and the Solana cluster would be set
   through Privy's Solana RPC configuration. This branch does not own the file,
   which is a further reason to keep the migration off it.
2. `src/components/Login.tsx` and `src/contexts/AuthContext.tsx`: use
   `usePrivy()` fields `ready`, `authenticated`, `user`, `login`, `logout` and
   `linkWallet`. All of these still exist on the 3.51 `PrivyInterface`. Re-check
   the `user.wallet` / linked account shapes read in `AuthContext.tsx`.
3. `src/services/apiAccess.ts`: `getAccessToken` is still exported in 3.51 (as
   an alias of `getCustomerAccessToken`). The server-side check in
   `api/_lib/privy-access.js` verifies the JWT with `jose` and does not use the
   SDK. Confirm the token issuer and audience are unchanged.
4. Peer dependencies: 3.x lists optional `@solana/kit` and `@solana-program/*`
   peers. A lockfile-only install with `legacy-peer-deps` succeeds without them.
   Decide whether the Solana connectors need `@solana/kit` at runtime.

Test plan: `npx tsc --noEmit -p tsconfig.json` (baseline 139 errors, no new
ones), `node --test tests/*.test.mjs`, `npx vite build`, then manual login on a
preview deployment with `VITE_PRIVY_ENABLED=true` for email, Google, Twitter,
Discord and wallet (Phantom, Backpack). Check that `getAccessToken()` tokens are
accepted by `/api/hume/generate-token` and that linking a wallet persists the
profile. Read the official Privy v2 -> v3 migration guide before starting. This
review used only the published 3.51.0 typings.

Recommendation: decide this on product grounds rather than as an audit fix.
It clears only the low-severity elliptic advisory and adds new transitive
moderates.

## hume

`hume` stays on 0.10.3, the newest release allowed by `^0.10.0`. A lockfile-only
install of 0.16.1 leaves the audit at 27 with `hume` still flagged high through
zod, so the upgrade clears nothing. The call sites (`HumeClient`,
`empathicVoice.chat.connect({ configId, resumedChatGroupId })`, `ChatSocket`
`on`/`sendAudioInput`/`socket`, `convertBlobToBase64`, `tts.synthesizeJson`)
still exist in 0.16.1. If hume is upgraded later for other reasons, retest the
EVI session flow in `src/services/humeEviService.ts` and
`src/services/honEviSessionService.ts`, and the SDK TTS calls in
`src/lib/hume-handlers.ts` and `src/server/humeApi.ts` (the dev server). The
Vercel functions under `api/hume/` and `api/tts/hume.js` call Hume's REST
endpoints with `fetch` and do not import the SDK.
