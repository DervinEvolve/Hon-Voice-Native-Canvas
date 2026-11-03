/**
 * Simple Runway Text-to-Image Service
 * Separate from runwayService.ts to avoid interfering with Scene Weaver/references features
 */

interface RunwayTextToImageOptions {
  ratio?: '1920:1080' | '1280:768' | '768:1280' | '1024:1024' | '1:1' | '4:3' | '3:4' | '21:9';
  seed?: number;
  guidance?: number;
}

class RunwayTextToImageService {
  /**
   * Simple text-to-image generation for AIControls
   */
  async generateImage(prompt: string, options: RunwayTextToImageOptions = {}): Promise<string> {
    try {
      // Start the task
      const response = await fetch('/api/runway/generate-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gen4_image',
          ratio: options.ratio || '1024:1024',
          promptText: prompt,
          seed: options.seed,
          guidance: options.guidance || 7.5
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Runway generation failed: ${response.statusText} - ${errorText}`);
      }

      const taskResult = await response.json();
      
      if (response.status !== 202) {
        throw new Error(`Expected 202 status for task creation, got ${response.status}`);
      }

      if (!taskResult.id) {
        throw new Error('No task ID returned from Runway API');
      }

      // Poll for completion
      return await this.pollTaskCompletion(taskResult.id);
    } catch (error) {
      console.error('Runway text-to-image generation error:', error);
      throw error;
    }
  }

  /**
   * Poll task completion for text-to-image
   */
  private async pollTaskCompletion(taskId: string): Promise<string> {
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes for text-to-image
    
    while (attempts < maxAttempts) {
      try {
        const statusResponse = await fetch(`/api/runway/status?taskId=${encodeURIComponent(taskId)}`);
        
        if (!statusResponse.ok) {
          throw new Error(`Status check failed: ${statusResponse.status}`);
        }
        
        const statusData = await statusResponse.json();
        console.log(`Runway task ${taskId} status:`, statusData.status);
        
        if (statusData.status === 'completed' || statusData.status === 'succeeded') {
          if (!statusData.output || statusData.output.length === 0) {
            throw new Error('No output generated');
          }
          return statusData.output[0];
        } else if (statusData.status === 'failed') {
          throw new Error(`Task failed: ${statusData.error || 'Unknown error'}`);
        }
        
        // Still pending, wait and try again
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
        
      } catch (error) {
        console.error(`Status check attempt ${attempts + 1} failed:`, error);
        attempts++;
        
        if (attempts >= maxAttempts) {
          throw new Error(`Text-to-image generation timed out after ${maxAttempts * 5} seconds`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    throw new Error(`Text-to-image generation timed out after ${maxAttempts * 5} seconds`);
  }
}

export const runwayTextToImageService = new RunwayTextToImageService(); 