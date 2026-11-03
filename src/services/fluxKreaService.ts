// Secure backend-based Flux Krea service with streaming support
export interface FluxKreaOptions {
  image_size?: string;
  num_inference_steps?: number;
  guidance_scale?: number;
  num_images?: number;
  enable_safety_checker?: boolean;
  output_format?: 'jpeg' | 'png';
  acceleration?: 'none' | 'regular' | 'high';
  stream?: boolean;
}

export interface StreamProgressEvent {
  type: 'progress' | 'complete' | 'error';
  status?: string;
  message?: string;
  imageUrl?: string;
  partialImageUrl?: string;
  error?: string;
  event?: any;
  result?: any;
}

export const fluxKreaService = {
  async generateImage(
    prompt: string, 
    options: FluxKreaOptions = {}, 
    onProgress?: (event: StreamProgressEvent) => void
  ): Promise<string> {
    try {
      console.log('Generating image with Flux.1 Krea (via backend) - Prompt:', prompt);

      const useStreaming = options.stream !== false && onProgress; // Default to streaming if callback provided

      if (useStreaming) {
        return await this.generateWithStreaming(prompt, options, onProgress!);
      } else {
        return await this.generateWithoutStreaming(prompt, options);
      }

    } catch (error) {
      console.error('Flux Krea generation error:', error);
      throw error;
    }
  },

  async generateWithStreaming(
    prompt: string, 
    options: FluxKreaOptions, 
    onProgress: (event: StreamProgressEvent) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // For SSE with POST data, we use fetch with stream response
      fetch('/api/flux/krea', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          prompt,
          image_size: options.image_size || 'landscape_4_3',
          num_inference_steps: options.num_inference_steps || 28,
          guidance_scale: options.guidance_scale || 4.5,
          num_images: options.num_images || 1,
          enable_safety_checker: options.enable_safety_checker !== false,
          output_format: options.output_format || 'jpeg',
          acceleration: options.acceleration || 'regular',
          stream: true
        }),
      }).then(async (response) => {
        if (!response.body) {
          throw new Error('Response body is null');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const eventData = line.slice(6); // Remove 'data: '
                if (eventData.trim()) {
                  try {
                    const event: StreamProgressEvent = JSON.parse(eventData);
                    
                    onProgress(event);

                    if (event.type === 'complete' && event.imageUrl) {
                      resolve(event.imageUrl);
                      return;
                    } else if (event.type === 'error') {
                      reject(new Error(event.error || 'Stream generation failed'));
                      return;
                    }
                  } catch (parseError) {
                    console.warn('Failed to parse SSE data:', eventData);
                  }
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      }).catch(reject);
    });
  },

  async generateWithoutStreaming(prompt: string, options: FluxKreaOptions): Promise<string> {
    const response = await fetch('/api/flux/krea', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_size: options.image_size || 'landscape_4_3',
        num_inference_steps: options.num_inference_steps || 28,
        guidance_scale: options.guidance_scale || 4.5,
        num_images: options.num_images || 1,
        enable_safety_checker: options.enable_safety_checker !== false,
        output_format: options.output_format || 'jpeg',
        acceleration: options.acceleration || 'regular',
        stream: false
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

    console.log('Flux.1 Krea generation completed:', result.imageUrl);
    return result.imageUrl;
  }
}; 