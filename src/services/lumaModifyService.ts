export interface LumaModifyOptions {
  prompt?: string;
  mode?: 'adhere_1' | 'adhere_2' | 'adhere_3' | 'flex_1' | 'flex_2' | 'flex_3' | 'reimagine_1' | 'reimagine_2' | 'reimagine_3';
}

export interface LumaModifyResult {
  success: boolean;
  modifiedVideoUrl: string;
  originalVideoUrl: string;
  referenceImageUrl: string;
  prompt: string;
  mode: string;
}

export const lumaModifyService = {
  /**
   * Modify a video using Luma Ray-2 Flash's style transfer capabilities
   * @param videoUrl - URL of the video to modify
   * @param referenceImageUrl - URL of the reference image for style transfer
   * @param options - Optional parameters for modification
   * @returns Promise with the modified video URL and metadata
   */
  async modifyVideo(
    videoUrl: string,
    referenceImageUrl: string,
    options: LumaModifyOptions = {}
  ): Promise<LumaModifyResult> {
    console.log('🎬 Starting Luma Ray-2 Flash video modification:', { 
      videoUrl: videoUrl.substring(0, 50) + '...',
      referenceImageUrl: referenceImageUrl.substring(0, 50) + '...',
      options,
      model: 'ray-flash-2'
    });

    try {
      const response = await fetch('/api/luma/modify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoUrl,
          imageUrl: referenceImageUrl,
          prompt: options.prompt,
          mode: options.mode || 'adhere_1'
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        
        // Log debug information if available
        if (errorData.debug) {
          console.error('Luma API Debug Info:', errorData.debug);
        }
        
        // Handle specific error cases for better UX
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please wait a moment and try again.');
        } else if (response.status === 408) {
          throw new Error('Video modification timed out. Please try with a shorter video.');
        } else if (response.status === 400) {
          throw new Error('Invalid video or image format. Please use supported formats.');
        }
        
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      if (!result.success || !result.modifiedVideoUrl) {
        throw new Error('Invalid response from video modification service');
      }

      console.log('✅ Luma Ray-2 Flash video modification completed:', {
        url: result.modifiedVideoUrl,
        model: result.model,
        processingTime: result.processingTimeSeconds ? `${result.processingTimeSeconds}s` : 'unknown',
        generationId: result.generationId
      });
      
      return result;

    } catch (error) {
      console.error('❌ Luma Ray-2 Flash video modification failed:', error);
      throw error;
    }
  },

  /**
   * Get available modification modes with descriptions
   */
  getAvailableModes() {
    return [
      {
        value: 'adhere_1',
        label: 'Adhere Light',
        description: 'Subtle style changes, preserves original motion & content'
      },
      {
        value: 'adhere_2', 
        label: 'Adhere Medium',
        description: 'Minor retexturing while keeping motion intact'
      },
      {
        value: 'adhere_3',
        label: 'Adhere Strong', 
        description: 'Light stylistic filter, motion fully preserved'
      },
      {
        value: 'flex_1',
        label: 'Flex Light',
        description: 'Balanced style transfer, maintains recognizable elements'
      },
      {
        value: 'flex_2',
        label: 'Flex Medium',
        description: 'Significant style changes, preserves core motion'
      },
      {
        value: 'flex_3',
        label: 'Flex Strong',
        description: 'Strong style adaptation while keeping motion flow'
      },
      {
        value: 'reimagine_1',
        label: 'Reimagine Light',
        description: 'Creative style transformation, loose motion adherence'
      },
      {
        value: 'reimagine_2',
        label: 'Reimagine Medium', 
        description: 'Major style overhaul, basic motion structure kept'
      },
      {
        value: 'reimagine_3',
        label: 'Reimagine Strong',
        description: 'Complete style reimagining, motion may vary significantly'
      }
    ];
  }
}; 