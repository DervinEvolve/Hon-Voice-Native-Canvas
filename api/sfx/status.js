import { withApiAccess } from "../_lib/api-access.js";
import { ownedProviderId, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from "@fal-ai/client";

 async function handler(req, res, context) {
	if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
	const token = req.query?.requestId;
	if (!token) return res.status(400).json({ error: 'Request ID is required' });
	// Only jobs this user started (see api/_lib/job-ownership.js).
	let requestId;
	try { requestId = ownedProviderId(context?.actor, 'sfx', token); }
	catch (error) { return sendJobOwnershipError(res, error); }
	try {
		fal.config({ credentials: process.env.FAL_API_KEY });
		const status = await fal.queue.status('mirelo-ai/sfx-v1/video-to-video', { requestId, logs: false });
		if (status.status === 'COMPLETED' && status.response_url) {
			// Try fetching the result URL without auth headers (FAL signed URL)
			let resultData = null;
			try {
				const resultResponse = await fetch(status.response_url);
				if (resultResponse.ok) {
					resultData = await resultResponse.json();
				} else {
					// If unauthorized, retry once with Authorization header (some models require it)
					if (resultResponse.status === 401 || resultResponse.status === 403) {
						const retry = await fetch(status.response_url, {
							headers: { 'Authorization': `Key ${process.env.FAL_API_KEY}` }
						});
						if (retry.ok) {
							resultData = await retry.json();
						} else if (status.result) {
							return res.status(200).json({ status: 'COMPLETED', result: status.result });
						} else {
							return res.status(200).json({ status: 'FAILED', error: `Upstream result fetch failed: ${retry.status}` });
						}
					} else {
						// If fetch fails but inline result exists, fall back to it
						if (status.result) {
							return res.status(200).json({ status: 'COMPLETED', result: status.result });
						}
						return res.status(200).json({ status: 'FAILED', error: `Upstream result fetch failed: ${resultResponse.status}` });
					}
				}
			} catch (e) {
				// Network or parsing issue; fall back to inline result when present
				if (status.result) {
					return res.status(200).json({ status: 'COMPLETED', result: status.result });
				}
				return res.status(200).json({ status: 'FAILED', error: 'Result retrieval failed' });
			}
			return res.status(200).json({ status: 'COMPLETED', result: resultData });
		}
		// If completed without response_url but inline result exists, return it
		if (status.status === 'COMPLETED' && status.result) {
			return res.status(200).json({ status: 'COMPLETED', result: status.result });
		}
		return res.status(200).json(status);
	} catch (error) {
		console.error('SFX status error:', error);
		return res.status(500).json({ error: 'Failed to fetch SFX status', details: error?.message });
	}
}

export default withApiAccess(handler, "/api/sfx/status");
