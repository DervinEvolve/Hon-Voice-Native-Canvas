import { createHmac, timingSafeEqual } from 'node:crypto';

// Provider job IDs are handed to the browser as "<provider id>.<tag>", where
// the tag is an HMAC over the route family, the verified user and the
// provider ID. A status or result route only looks up a job whose tag matches
// its own family and the caller, so one allowlisted user cannot read another
// user's provider results by guessing or reusing an ID, and a token issued by
// one provider pair cannot be replayed against another. The browser treats
// the value as opaque, so polling clients pass it back unchanged.
//
// A family is the name shared by one submit route and the routes that read
// its job back (status, result, mux, stream). Two submit routes that feed the
// same status route share a family.

const PROVIDER_ID = /^[A-Za-z0-9_-]{1,128}$/;
const FAMILY = /^[a-z0-9][a-z0-9/-]{0,63}$/;
const TOKEN = /^([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9_-]{32})$/;

export class JobOwnershipError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function signingSecret() {
  const secret = process.env.HON_JOB_ID_SECRET || process.env.HON_OAUTH_STATE_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) throw new JobOwnershipError(503, 'Job ownership is not configured');
  return secret;
}

function checkedFamily(family) {
  if (typeof family !== 'string' || !FAMILY.test(family)) throw new JobOwnershipError(500, 'Job family is not configured');
  return family;
}

function tag(secret, family, actor, providerId) {
  return createHmac('sha256', secret).update(`hon-job:v2\0${family}\0${actor}\0${providerId}`).digest('base64url').slice(0, 32);
}

// Call before starting a paid job, so a missing secret stops the request
// before any provider is charged. Returns a function that wraps provider IDs.
export function jobTokenIssuer(actor, family) {
  if (typeof actor !== 'string' || !actor) throw new JobOwnershipError(401, 'A verified user is required');
  const secret = signingSecret();
  checkedFamily(family);
  return providerId => {
    if (typeof providerId !== 'string' || !PROVIDER_ID.test(providerId)) throw new JobOwnershipError(502, 'Provider returned an unexpected job ID');
    return `${providerId}.${tag(secret, family, actor, providerId)}`;
  };
}

// Returns the provider ID when the token belongs to this user and family,
// otherwise null. A bare provider ID is never accepted.
export function readJobToken(actor, family, token) {
  if (typeof actor !== 'string' || !actor || typeof token !== 'string') return null;
  const match = TOKEN.exec(token);
  if (!match) return null;
  const expected = Buffer.from(tag(signingSecret(), checkedFamily(family), actor, match[1]));
  const given = Buffer.from(match[2]);
  return expected.length === given.length && timingSafeEqual(expected, given) ? match[1] : null;
}

// For status and result routes: the provider ID for this user's job, or a
// JobOwnershipError. Missing, forged and other users' tokens all read as
// "not found" so the response does not reveal whether the job exists.
export function ownedProviderId(actor, family, token) {
  const providerId = readJobToken(actor, family, token);
  if (!providerId) throw new JobOwnershipError(404, 'Job not found');
  return providerId;
}

// Sends the error a route should return when the helpers above throw.
export function sendJobOwnershipError(res, error) {
  const known = error instanceof JobOwnershipError;
  return res.status(known ? error.status : 503).json({ error: known ? error.message : 'Job ownership check failed' });
}
