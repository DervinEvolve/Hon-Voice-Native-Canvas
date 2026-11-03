import { fal } from "@fal-ai/client";

export interface PikaVideoGenerationOptions {
  quality?: 'standard' | 'high';
  duration?: number;
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:5' | '5:4' | '3:2' | '2:3';
  ingredientsMode?: 'creative' | 'precise';
  maxRetries?: number;
  timeoutSeconds?: number;
  onProgress?: (progressMessage: string) => void;
}

export const pikaVideoService = {
  generateVideo: async (
    prompt: string | null | undefined, 
    referenceImages: string[], 
    options?: PikaVideoGenerationOptions
  ): Promise<string> => {
    console.log('🎥 PIKA Scenes generation request:', { 
      imageCount: referenceImages.length,
      options 
    });
    
    // Set default values
    const maxRetries = options?.maxRetries || 2;
    const timeoutSeconds = options?.timeoutSeconds || 300; // Default 5 minute timeout
    const onProgress = options?.onProgress || (() => {});
    let currentRetry = 0;
    let lastError: any = null;
    
    // Map from our API to actual resolution values
    const qualityToResolution = {
      'standard': '720p',
      'high': '1080p'
    };
    
    while (currentRetry <= maxRetries) {
      try {
        // Prepare the input for the API call
        const images = referenceImages.map(image_url => ({ image_url }));
        
        // Select the model based on availability
        // Changed from collection-to-video (v2.1) to pikascenes (v2.2)
        const model = "fal-ai/pika/v2.2/pikascenes";
        
        // Create the input for the API
        const input = {
          prompt: prompt || '',
          images,
          duration: options?.duration || 5,
          resolution: qualityToResolution[options?.quality || 'standard'],
          aspect_ratio: options?.aspectRatio || '16:9',
          ingredients_mode: options?.ingredientsMode || 'creative'
        };
        
        if (currentRetry > 0) {
          console.log(`Retry attempt ${currentRetry}/${maxRetries} for video generation`);
          onProgress(`Retry attempt ${currentRetry}/${maxRetries} for video generation`);
        }
        
        console.log('Generating video with Pika Scenes:', input);
        onProgress('Initializing video generation...');
        
        // Track when generation started
        const startTime = Date.now();
        let lastProgressUpdate = startTime;
        let statusUpdateCount = 0;
        
        // Create a timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Pika video generation timed out after ${timeoutSeconds} seconds`));
          }, timeoutSeconds * 1000);
        });
        
        // Call the Fal API with timeout
        const apiPromise = fal.subscribe(model, {
          input,
          logs: true,
          onQueueUpdate: (update) => {
            const currentTime = Date.now();
            statusUpdateCount++;
            
            // Debug logs for monitoring API status
            console.log(`Status update #${statusUpdateCount} (${update.status}):`, update);
            
            if (update.status === "IN_PROGRESS") {
              const progressMessages = update.logs?.map(log => log.message);
              console.log('Pika generation progress:', progressMessages);
              
              if (progressMessages && progressMessages.length > 0) {
                // Report the latest message
                onProgress(progressMessages[progressMessages.length - 1]);
              } else {
                const elapsedSeconds = Math.floor((currentTime - startTime) / 1000);
                const sinceLastUpdate = Math.floor((currentTime - lastProgressUpdate) / 1000);
                onProgress(`Processing... (${elapsedSeconds}s elapsed, ${sinceLastUpdate}s since last update)`);
              }
            } else if (update.status === "IN_QUEUE") {
              const elapsedSeconds = Math.floor((currentTime - startTime) / 1000);
              onProgress(`Waiting in queue... (${elapsedSeconds}s elapsed)`);
            } else {
              // Log any other status updates
              console.log(`Pika generation status: ${update.status}`);
              onProgress(`Status: ${update.status}`);
              
              if (update.status === "COMPLETED") {
                const duration = Math.floor((currentTime - startTime) / 1000);
                console.log(`Pika generation completed in ${duration} seconds`);
                onProgress(`Generation completed in ${duration} seconds`);
              }
            }
            
            // Update the last progress timestamp
            lastProgressUpdate = currentTime;
          },
        });
        
        // Race between API call and timeout
        const result = await Promise.race([apiPromise, timeoutPromise]);

        console.log('Pika generation completed:', result);
        onProgress('Processing complete, retrieving video...');

        if (!result.data?.video?.url) {
          console.error('No video URL in response:', result);
          throw new Error('No video URL in response');
        }

        const videoUrl = result.data.video.url;
        console.log('📥 Received Pika video URL:', videoUrl);
        onProgress('Video ready!');
        
        // Validate the video URL by pinging it
        try {
          const response = await fetch(videoUrl, { method: 'HEAD' });
          if (!response.ok) {
            console.error('Video URL is not accessible:', response.status, response.statusText);
            throw new Error(`Video URL returned status ${response.status}`);
          }
        } catch (error) {
          console.error('Error validating video URL:', error);
          // Continue anyway, as the URL might still work in the video element
        }
        
        return videoUrl;
      } catch (error) {
        if (error instanceof Error) {
          lastError = error;
          const isTimeout = error.message.includes('timed out');
          console.error(`❌ Pika video generation ${isTimeout ? 'timed out' : 'failed'} (attempt ${currentRetry+1}/${maxRetries+1}):`, error);
          onProgress(`Error: ${isTimeout ? 'Generation timed out' : error.message}`);
          
          // Only retry if this wasn't the last attempt
          if (currentRetry < maxRetries) {
            currentRetry++;
            // Add exponential backoff between retries
            const backoffTime = 2000 * Math.pow(2, currentRetry);
            console.log(`Waiting ${backoffTime/1000} seconds before retry ${currentRetry}...`);
            onProgress(`Waiting ${backoffTime/1000} seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, backoffTime));
          } else {
            // This was the last attempt, so throw the error
            throw error;
          }
        } else {
          throw error;
        }
      }
    }
    
    // This shouldn't be reached due to the throw in the catch block,
    // but TypeScript needs a return statement
    throw lastError || new Error('Video generation failed with unspecified error');
  }
}; 