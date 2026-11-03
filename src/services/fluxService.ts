// Secure backend-based Flux service
export const fluxService = {
	async generateImage(prompt: string): Promise<string> {
		try {
			console.log('Generating image with Flux LoRA (via backend) - Prompt:', prompt);

			const response = await fetch('/api/flux/lora', {
				method: 'POST',
				headers:	{
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					prompt,
					image_size: 'landscape_4_3',
					num_inference_steps: 28,
					guidance_scale: 3.5,
					num_images: 1,
					enable_safety_checker: true,
					output_format: 'jpeg'
				}),
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
				throw new Error(`Image generation failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
			}

			const result = await response.json();
			
			if (!result.imageUrl) {
				throw new Error('No image URL in response');
			}

			console.log('Flux LoRA generation completed (via backend):', result.imageUrl);
			return result.imageUrl;

		} catch (error) {
			console.error('Flux LoRA API error (backend):', error);
			throw error;
		}
	},

	async editImage(prompt: string, sourceImageUrl: string): Promise<string> {
		try {
			const response = await fetch('http://localhost:3000/api/ai/edit', {
				method: 'POST',
				headers:	{
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ prompt, imageUrl: sourceImageUrl }),
			});

			if (!response.ok) {
				throw new Error('Failed to edit image');
			}

			const data = await response.json();
			return data.url;
		} catch (error) {
			console.error('Flux API error:', error);
			throw error;
		}
	}
};
