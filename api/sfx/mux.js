import { withApiAccess } from "../_lib/api-access.js";
// Build a Cloudinary fetch transformation that overlays external audio on a video
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.VITE_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

 async function handler(req, res) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	if (req.method === 'OPTIONS') return res.status(200).end();

	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed, use POST' });
	}

	try {
		const { video_url, audio_url, duration, persist } = req.body || {};
		if (!video_url || !audio_url) return res.status(400).json({ error: 'Missing video_url or audio_url' });

		const cloudName = process.env.VITE_CLOUDINARY_CLOUD_NAME;
		if (!cloudName) return res.status(500).json({ error: 'Cloudinary cloud name not configured' });

		// Encode URLs for Cloudinary fetch
		const encVideo = encodeURIComponent(video_url);
		const encAudio = encodeURIComponent(audio_url);

		// Optional: trim audio to duration seconds if provided; cap to 8s to avoid upstream 422 and keep sync tight
		const maxDur = 8;
		const trimmed = typeof duration === 'number' && duration > 0 ? Math.min(Math.floor(duration), maxDur) : undefined;

		// Build Cloudinary transformation: ensure audio starts at 0 and optionally trim
		const audioLayer = `l_audio:fetch:${encAudio}${trimmed ? `,so_0,du_${trimmed}` : `,so_0`}/fl_layer_apply`;

		// Build a fetch URL: overlay external audio on fetched video
		const muxUrl = `https://res.cloudinary.com/${cloudName}/video/fetch/${audioLayer}/${encVideo}`;

		if (persist && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
			try {
				const upload = await cloudinary.uploader.upload(muxUrl, {
					resource_type: 'video',
					folder: 'hon-comics/sfx',
					public_id: `sfx-${Date.now()}`
				});
				return res.status(200).json({ videoUrl: upload.secure_url });
			} catch (e) {
				console.warn('Cloudinary persist failed, falling back to fetch URL:', e?.message);
			}
		}

		return res.status(200).json({ videoUrl: muxUrl });
	} catch (error) {
		console.error('SFX mux error:', error);
		return res.status(500).json({ error: error?.message || 'Unknown error' });
	}
}

export default withApiAccess(handler, "/api/sfx/mux");
