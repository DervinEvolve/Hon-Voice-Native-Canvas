interface RunwayReferenceImage {
  uri: string;
  tag: string;
}

interface RunwayGenerationOptions {
  model?: 'gen4_image';
  ratio?: '1920:1080' | '1280:768' | '768:1280' | '1024:1024' | '1:1' | '4:3' | '3:4' | '21:9';
  promptText: string;
  referenceImages?: RunwayReferenceImage[];
  seed?: number;
  guidance?: number;
  steps?: number;
}

interface RunwayGenerationResult {
  id: string;
  output: string[];
  status: 'completed' | 'failed' | 'pending';
}

interface CharacterAnalysis {
  characterImageUrl: string;
  characterTag: string;
  description: string;
}

interface LocationAnalysis {
  locationImageUrl: string;
  locationTag: string;
  description: string;
}

interface StyleAnalysis {
  styleImageUrl: string;
  styleTag: string;
  description: string;
}

class RunwayService {
  private baseUrl = 'https://api.dev.runwayml.com/v1';

  /**
   * Advanced Character-Consistent Scene Generation
   * Uses up to 3 references: character, location, and style
   */
  async generateAdvancedScene(options: {
    character?: CharacterAnalysis;
    location?: LocationAnalysis;
    style?: StyleAnalysis;
    scenePrompt: string;
    ratio?: string;
  }): Promise<string> {
    const referenceImages: RunwayReferenceImage[] = [];
    let enhancedPrompt = options.scenePrompt;

    // Build reference system with up to 3 references
    if (options.character) {
      referenceImages.push({
        uri: options.character.characterImageUrl,
        tag: options.character.characterTag
      });
      enhancedPrompt += ` featuring @${options.character.characterTag}`;
    }

    if (options.location) {
      referenceImages.push({
        uri: options.location.locationImageUrl,
        tag: options.location.locationTag
      });
      enhancedPrompt += ` in @${options.location.locationTag}`;
    }

    if (options.style) {
      referenceImages.push({
        uri: options.style.styleImageUrl,
        tag: options.style.styleTag
      });
      enhancedPrompt += ` with @${options.style.styleTag} visual style`;
    }

    return this.generateImageWithReferences({
      promptText: enhancedPrompt,
      referenceImages,
      ratio: options.ratio as any || '1024:1024'
    });
  }

  /**
   * Character Consistency Pipeline
   * Extracts character from one image and places in new scenes
   */
  async generateCharacterConsistentSequence(
    panels: Array<{ imageUrl: string; prompt: string }>,
    characterSourcePanel: number = 0
  ): Promise<string[]> {
    const characterReference = panels[characterSourcePanel];
    const results: string[] = [];

    for (let i = 0; i < panels.length; i++) {
      if (i === characterSourcePanel) {
        // Use original image for character source
        results.push(panels[i].imageUrl);
        continue;
      }

      // Generate new scene with character consistency
      const result = await this.generateAdvancedScene({
        character: {
          characterImageUrl: characterReference.imageUrl,
          characterTag: 'hero',
          description: 'main character'
        },
        scenePrompt: panels[i].prompt,
        ratio: '1024:1024'
      });

      results.push(result);
    }

    return results;
  }

  /**
   * Style Transfer Across Sequence
   * Maintains consistent visual style across all panels
   */
  async generateStyleConsistentSequence(
    panels: Array<{ imageUrl: string; prompt: string }>,
    styleSourcePanel: number = 0
  ): Promise<string[]> {
    const styleReference = panels[styleSourcePanel];
    const results: string[] = [];

    for (const panel of panels) {
      const result = await this.generateAdvancedScene({
        style: {
          styleImageUrl: styleReference.imageUrl,
          styleTag: 'aesthetic',
          description: 'visual style'
        },
        scenePrompt: panel.prompt,
        ratio: '1024:1024'
      });

      results.push(result);
    }

    return results;
  }

  /**
   * Multi-Reference Transition Generation
   * Creates seamless transitions between scenes using multiple references
   */
  async generateMultiReferenceTransition(
    scene1: { imageUrl: string; description: string },
    scene2: { imageUrl: string; description: string },
    transitionStyle?: { imageUrl: string; description: string }
  ): Promise<string> {
    const referenceImages: RunwayReferenceImage[] = [
      { uri: scene1.imageUrl, tag: 'scene1' },
      { uri: scene2.imageUrl, tag: 'scene2' }
    ];

    let prompt = `Create a seamless transition blending @scene1 (${scene1.description}) with @scene2 (${scene2.description})`;

    if (transitionStyle) {
      referenceImages.push({ uri: transitionStyle.imageUrl, tag: 'style' });
      prompt += ` using @style visual approach`;
    }

    return this.generateImageWithReferences({
      promptText: prompt,
      referenceImages,
      ratio: '1024:1024'
    });
  }

  /**
   * Contextual Local Editing
   * Edit specific parts of an image while maintaining consistency
   */
  async generateLocalEdit(
    sourceImageUrl: string,
    editPrompt: string,
    region?: string // "background", "foreground", "character", etc.
  ): Promise<string> {
    const referenceImages: RunwayReferenceImage[] = [
      { uri: sourceImageUrl, tag: 'original' }
    ];

    let prompt = `Starting from @original, ${editPrompt}`;
    if (region) {
      prompt += ` focusing on the ${region} while maintaining overall consistency`;
    }

    return this.generateImageWithReferences({
      promptText: prompt,
      referenceImages,
      ratio: '1024:1024'
    });
  }

  /**
   * Advanced Product Placement
   * Place objects/products consistently across different scenes
   */
  async generateProductPlacement(
    productImageUrl: string,
    sceneImageUrl: string,
    placementPrompt: string
  ): Promise<string> {
    return this.generateAdvancedScene({
      character: {
        characterImageUrl: productImageUrl,
        characterTag: 'product',
        description: 'product to place'
      },
      location: {
        locationImageUrl: sceneImageUrl,
        locationTag: 'scene',
        description: 'target environment'
      },
      scenePrompt: `${placementPrompt} showing @product naturally integrated into @scene`
    });
  }

  /**
   * Core generation method with full Runway capabilities
   * Now uses async polling to avoid Vercel timeout limits
   */
  async generateImageWithReferences(options: RunwayGenerationOptions): Promise<string> {
    try {
      // Start the task
      const response = await fetch('/api/runway/generate-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model || 'gen4_image',
          ratio: options.ratio || '1024:1024',
          promptText: options.promptText,
          referenceImages: options.referenceImages || [],
          seed: options.seed,
          guidance: options.guidance || 7.5,
          steps: options.steps || 30
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Runway generation failed: ${response.statusText} - ${errorText}`);
      }

      const taskResult = await response.json();
      // Our server returns 202 for async task creation
      if (response.status !== 202 || !taskResult?.id) {
        throw new Error(`Expected 202 with task id for async task creation, got ${response.status}`);
      }

      // Poll for completion
      return await this.pollTaskCompletion(taskResult.id);
    } catch (error) {
      console.error('Runway generation error:', error);
      throw error;
    }
  }

  /**
   * Poll task completion to avoid timeout issues
   */
  private async pollTaskCompletion(taskId: string): Promise<string> {
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes total (was 60/5 minutes)
    
    while (attempts < maxAttempts) {
      try {
        const statusResponse = await fetch(`/api/runway/status?taskId=${encodeURIComponent(taskId)}`);
        
        if (!statusResponse.ok) {
          throw new Error(`Status check failed: ${statusResponse.status}`);
        }
        
        const statusData = await statusResponse.json();
        console.log(`Task ${taskId} status:`, statusData.status);
        console.log(`Task ${taskId} full response:`, statusData);
        
        if (statusData.status === 'completed') {
          console.log(`Task ${taskId} is completed! Output:`, statusData.output);
          if (!statusData.output || statusData.output.length === 0) {
            throw new Error('No output generated');
          }
          console.log(`Task ${taskId} returning result:`, statusData.output[0]);
          return statusData.output[0];
        } else if (statusData.status === 'succeeded') {
          console.log(`Task ${taskId} is succeeded! Output:`, statusData.output);
          if (!statusData.output || statusData.output.length === 0) {
            throw new Error('No output generated');
          }
          console.log(`Task ${taskId} returning result:`, statusData.output[0]);
          return statusData.output[0];
        } else if (statusData.status === 'failed') {
          throw new Error(`Task failed: ${statusData.error || 'Unknown error'}`);
        }
        
        console.log(`Task ${taskId} still pending, attempt ${attempts + 1}/${maxAttempts}`);
        
        // Still pending, wait and try again
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
        
      } catch (error) {
        console.error(`Status check attempt ${attempts + 1} failed:`, error);
        
        // If it's a network error but we've been polling for a while, check one more time
        if (attempts > 10) {
          try {
            const finalCheckResponse = await fetch(`/api/runway/status?taskId=${encodeURIComponent(taskId)}`);
            if (finalCheckResponse.ok) {
              const finalCheckData = await finalCheckResponse.json();
              if (finalCheckData.status === 'completed' && finalCheckData.output?.length > 0) {
                console.log(`Task ${taskId} completed on final check despite polling error`);
                return finalCheckData.output[0];
              }
            }
          } catch (finalError) {
            console.log('Final check also failed, continuing with normal error handling');
          }
        }
        
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    // Before giving up, try one final status check
    try {
      const finalResponse = await fetch(`/api/runway/status?taskId=${encodeURIComponent(taskId)}`);
      if (finalResponse.ok) {
        const finalData = await finalResponse.json();
        if (finalData.status === 'completed' && finalData.output?.length > 0) {
          console.log(`Task ${taskId} was actually completed despite timeout`);
          return finalData.output[0];
        }
      }
    } catch (finalError) {
      console.log('Final timeout check failed');
    }
    
    throw new Error(`Task timed out after ${maxAttempts} attempts (${maxAttempts * 5 / 60} minutes)`);
  }

  /**
   * Analyze panel for character extraction
   */
  async analyzeCharacter(imageUrl: string, description?: string): Promise<CharacterAnalysis> {
    return {
      characterImageUrl: imageUrl,
      characterTag: 'character',
      description: description || 'main character from the scene'
    };
  }

  /**
   * Analyze panel for location extraction
   */
  async analyzeLocation(imageUrl: string, description?: string): Promise<LocationAnalysis> {
    return {
      locationImageUrl: imageUrl,
      locationTag: 'location',
      description: description || 'environment and setting from the scene'
    };
  }

  /**
   * Analyze panel for style extraction
   */
  async analyzeStyle(imageUrl: string, description?: string): Promise<StyleAnalysis> {
    return {
      styleImageUrl: imageUrl,
      styleTag: 'style',
      description: description || 'visual style and aesthetic from the scene'
    };
  }

  /**
   * Convert comic panel to living video using Runway ML
   * This implements the user's vision for seamless living comic experience
   */
  async convertPanelToVideo(options: {
    imageUrl: string;
    prompt: string;
    duration?: 5 | 10;
    ratio?: string;
    characterReference?: string; // For character consistency
  }): Promise<string> {
    try {
      const response = await fetch('/api/runway/image-to-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          promptImage: options.imageUrl,
          promptText: options.prompt,
          duration: options.duration || 5,
          ratio: options.ratio || '1280:720',
          model: 'gen4_turbo'
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Runway video generation failed: ${response.statusText} - ${errorText}`);
      }

      const taskResult = await response.json();
      
      // The Runway API returns 200 with task ID, not 202
      if (response.status !== 200) {
        throw new Error(`Expected 200 status for video task creation, got ${response.status}`);
      }

      if (!taskResult.id) {
        throw new Error('No task ID returned from Runway API');
      }

      console.log('Runway video task started:', taskResult.id);

      // Poll for completion
      return await this.pollTaskCompletion(taskResult.id);
    } catch (error) {
      console.error('Runway video generation error:', error);
      throw error;
    }
  }

  

  /**
   * Auto-detect living comic opportunities from panels
   * This is the core of Option A - zero-typing experience
   */
  async detectLivingComicOpportunities(panels: Array<{ imageUrl: string; caption?: string }>): Promise<Array<{
    panelIndex: number;
    confidence: number;
    suggestedPrompt: string;
    reason: string;
  }>> {
    const opportunities = [];

    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      
      // Simple heuristic-based detection (could be enhanced with AI analysis)
      let confidence = 0;
      let suggestedPrompt = '';
      let reason = '';

      // Check for character presence
      if (panel.caption?.toLowerCase().includes('character') || 
          panel.caption?.toLowerCase().includes('person') ||
          panel.caption?.toLowerCase().includes('hero')) {
        confidence += 0.3;
        suggestedPrompt += 'character moving naturally, ';
        reason += 'Character detected. ';
      }

      // Check for action words
      const actionWords = ['walking', 'running', 'flying', 'moving', 'dancing', 'fighting'];
      if (actionWords.some(word => panel.caption?.toLowerCase().includes(word))) {
        confidence += 0.4;
        suggestedPrompt += 'dynamic motion and movement, ';
        reason += 'Action detected. ';
      }

      // Check for environmental elements
      if (panel.caption?.toLowerCase().includes('wind') ||
          panel.caption?.toLowerCase().includes('water') ||
          panel.caption?.toLowerCase().includes('fire')) {
        confidence += 0.3;
        suggestedPrompt += 'environmental effects, ';
        reason += 'Environmental animation potential. ';
      }

      // Clean up prompt
      suggestedPrompt = suggestedPrompt.replace(/, $/, '');
      if (!suggestedPrompt) {
        suggestedPrompt = 'subtle animation bringing the scene to life';
      }

      // Only suggest if confidence is above threshold
      if (confidence > 0.2) {
        opportunities.push({
          panelIndex: i,
          confidence,
          suggestedPrompt,
          reason: reason.trim()
        });
      }
    }

    return opportunities;
  }
}

export const runwayService = new RunwayService(); 