import { withApiAccess } from "../_lib/api-access.js";
import { jobTokenIssuer, sendJobOwnershipError } from "../_lib/job-ownership.js";
import { fal } from "@fal-ai/client";

 async function handler(req, res, context) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	if (req.method === 'OPTIONS') return res.status(200).end();

	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed, use POST' });
	}

	// Check job ownership signing before any provider call.
	let issueJobToken;
	try { issueJobToken = jobTokenIssuer(context?.actor, 'sfx'); }
	catch (error) { return sendJobOwnershipError(res, error); }

	try {
		const { video_url, text_prompt, num_samples = 1, seed, duration } = req.body || {};
		if (!video_url) return res.status(400).json({ error: 'Missing video_url' });

		const apiKey = process.env.FAL_API_KEY;
		if (!apiKey) {
			console.error('FAL_API_KEY not set');
			return res.status(500).json({ error: 'Service configuration error' });
		}

		fal.config({ credentials: apiKey });

		// Use video-to-video for faster direct output
		const submit = await fal.queue.submit('mirelo-ai/sfx-v1/video-to-video', {
			input: {
				video_url,
				...(text_prompt ? { text_prompt } : {}),
				...(typeof num_samples === 'number' ? { num_samples } : {}),
				...(typeof seed === 'number' ? { seed } : {}),
				...(typeof duration === 'number' ? { duration } : {})
			}
		});

		if (!submit?.request_id) {
			return res.status(500).json({ error: 'Failed to submit SFX job' });
		}

		console.log('[AI] sfx_submit queued', { id: submit.request_id });
		return res.status(202).json({ request_id: issueJobToken(submit.request_id) });
	} catch (error) {
		console.error('SFX submit error:', error);
		return res.status(500).json({ error: error?.message || 'Unknown error' });
	}
}

export default withApiAccess(handler, "/api/sfx/submit");
