# Canvas media downloads

The existing `/api/download-image` route serves image and video attachments. It now verifies a Supabase or Privy access token and checks `HON_MEDIA_ALLOWED_USER_IDS` before making a network request. Wallet connection or a browser-supplied profile ID is not proof of a session.

Set the server-only user allowlist to the exact Supabase user IDs or Privy DIDs that may use the proxy. Privy requires the same pinned public verification key described in `SPLAT_SECURITY_SETUP.md`. Missing configuration fails closed. Do not put server keys in browser variables.

Set `HON_MEDIA_DOWNLOAD_HOSTS` to the exact HTTPS CDN hostnames used by your generation providers, separated by commas. Wildcards and suffix matches are not supported. This project's configured Supabase host is also permitted for `/storage/v1/object/` URLs. Approve only hosts you trust; do not add arbitrary user domains or hosts that resolve to private infrastructure.

Downloads reject redirects, credentials in URLs, nonstandard ports, literal IP addresses, active document types, and responses above 64 MiB. Requests time out after 30 seconds. Responses are attachments with `nosniff` and `no-store`; errors do not echo signed URLs. The same restrictions apply to the optional local CORS proxy, which binds only to loopback.

Deploy the server and updated callers together. Verify one image and one MP4 with the real sign-in flow and actual provider hosts before rollout. Files larger than the limit need an owned storage/export flow; do not restore the arbitrary URL proxy. The broader generation/OAuth API authorization review is separate and remains incomplete.
