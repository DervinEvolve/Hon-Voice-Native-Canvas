// Secure backend-based Recraft service
export type RecraftStyle = 
  | "realistic_image" 
  | "digital_illustration" 
  | "vector_illustration" 
  | "realistic_image/b_and_w" 
  | "realistic_image/hard_flash" 
  | "realistic_image/hdr" 
  | "realistic_image/natural_light" 
  | "realistic_image/studio_portrait" 
  | "realistic_image/enterprise" 
  | "realistic_image/motion_blur" 
  | "realistic_image/evening_light" 
  | "realistic_image/faded_nostalgia" 
  | "realistic_image/forest_life" 
  | "realistic_image/mystic_naturalism" 
  | "realistic_image/natural_tones" 
  | "realistic_image/organic_calm" 
  | "realistic_image/real_life_glow" 
  | "realistic_image/retro_realism" 
  | "realistic_image/retro_snapshot" 
  | "realistic_image/urban_drama" 
  | "realistic_image/village_realism" 
  | "realistic_image/warm_folk" 
  | "digital_illustration/pixel_art" 
  | "digital_illustration/hand_drawn" 
  | "digital_illustration/grain" 
  | "digital_illustration/infantile_sketch" 
  | "digital_illustration/2d_art_poster" 
  | "digital_illustration/handmade_3d" 
  | "digital_illustration/hand_drawn_outline" 
  | "digital_illustration/engraving_color" 
  | "digital_illustration/2d_art_poster_2" 
  | "digital_illustration/antiquarian" 
  | "digital_illustration/bold_fantasy" 
  | "digital_illustration/child_book" 
  | "digital_illustration/child_books" 
  | "digital_illustration/cover" 
  | "digital_illustration/crosshatch" 
  | "digital_illustration/digital_engraving" 
  | "digital_illustration/expressionism" 
  | "digital_illustration/freehand_details" 
  | "digital_illustration/grain_20" 
  | "digital_illustration/graphic_intensity" 
  | "digital_illustration/hard_comics" 
  | "digital_illustration/long_shadow" 
  | "digital_illustration/modern_folk" 
  | "digital_illustration/multicolor" 
  | "digital_illustration/neon_calm" 
  | "digital_illustration/nostalgic_pastel" 
  | "digital_illustration/outline_details" 
  | "digital_illustration/pastel_gradient" 
  | "digital_illustration/pastel_tech" 
  | "digital_illustration/rich_and_deep" 
  | "digital_illustration/soft_colors" 
  | "digital_illustration/solid_colors" 
  | "digital_illustration/soothing_blues" 
  | "digital_illustration/sunset_orange" 
  | "digital_illustration/textured_flat" 
  | "digital_illustration/vibrant_gradient" 
  | "digital_illustration/warm_grays" 
  | "vector_illustration/badge" 
  | "vector_illustration/clean" 
  | "vector_illustration/logo" 
  | "vector_illustration/logo_emblem" 
  | "vector_illustration/engraving" 
  | "vector_illustration/line_art" 
  | "vector_illustration/line_art_simple" 
  | "vector_illustration/minimalism" 
  | "vector_illustration/seamless" 
  | "vector_illustration/thick_lines";

export type RecraftImageSize = 
  | "1024x1024" 
  | "1365x1024" 
  | "1024x1365" 
  | "1536x1024" 
  | "1024x1536" 
  | "1820x1024" 
  | "1024x1820" 
  | "1024x2048" 
  | "2048x1024" 
  | "1434x1024" 
  | "1024x1434" 
  | "1024x1280" 
  | "1280x1024" 
  | "1024x1707";

export interface RecraftOptions {
  style?: RecraftStyle;
  image_size?: RecraftImageSize;
  colors?: Array<{ r: number; g: number; b: number }>;
}

export const recraftService = {
  async generateImage(prompt: string, options: RecraftOptions = {}): Promise<string> {
    try {
      console.log('Starting Recraft V3 generation (via backend) - Prompt:', prompt);

      const response = await fetch('/api/recraft/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          ...options
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

      console.log('Recraft generation completed (via backend):', result.imageUrl);
      return result.imageUrl;

    } catch (error) {
      console.error('Recraft V3 API error (backend):', error);
      throw error;
    }
  }
}; 