// Secure backend-based Ideogram service
export type IdeogramStyle = 
  | "auto"
  | "general"
  | "realistic"
  | "design"
  | "render_3D"
  | "anime";

export type IdeogramAspectRatio = 
  | "1:1"
  | "16:9"
  | "9:16"
  | "4:3"
  | "3:4"
  | "16:10"
  | "10:16"
  | "3:2"
  | "2:3"
  | "1:3"
  | "3:1";

export interface IdeogramOptions {
  style?: IdeogramStyle;
  aspect_ratio?: IdeogramAspectRatio;
  negative_prompt?: string;
  expand_prompt?: boolean;
  seed?: number;
}

export const ideogramService = {
  async generateImage(prompt: string, options: IdeogramOptions = {}): Promise<string> {
    try {
      console.log('Generating image with Ideogram (via backend) - Prompt:', prompt);

      const response = await fetch('/api/ideogram/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          style: options.style || "auto",
          aspect_ratio: options.aspect_ratio || "1:1",
          negative_prompt: options.negative_prompt || "",
          expand_prompt: options.expand_prompt !== undefined ? options.expand_prompt : true,
          ...(options.seed !== undefined && { seed: options.seed })
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

      console.log('Ideogram generation completed (via backend):', result.imageUrl);
      return result.imageUrl;

    } catch (error) {
      console.error('Ideogram API error (backend):', error);
      throw error;
    }
  }
}; 