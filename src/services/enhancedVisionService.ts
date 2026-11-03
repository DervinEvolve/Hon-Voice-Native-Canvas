/**
 * Enhanced Vision Service
 * Combines SAM3 object detection with Isaac-01 vision for improved awareness and accuracy
 * 
 * SAM3 provides precise object segmentation and detection
 * Isaac-01 provides semantic understanding and relationships
 * Together: Better canvas awareness and editing accuracy
 */

import { analyzeWithIsaacStreaming, IsaacResultPartial } from './visionService';
import { detectObjects } from './sam3DetectionService';

export interface EnhancedVisionResult extends IsaacResultPartial {
  detectedObjects?: string[];
  objectMasks?: Array<{
    object: string;
    confidence: number;
    box?: number[];
  }>;
  combinedAnalysis?: string; // Combined SAM3 + Isaac insights
}

/**
 * Enhanced vision analysis combining SAM3 and Isaac-01
 * Provides both object detection (SAM3) and semantic understanding (Isaac)
 */
export async function analyzeWithEnhancedVision(
  imageUrl: string,
  options: {
    prompt?: string;
    response_style?: 'text' | 'box' | 'point' | 'polygon';
    useSAM3?: boolean; // Include SAM3 object detection
    useIsaac?: boolean; // Include Isaac vision analysis
  } = {},
  onPartial?: (result: EnhancedVisionResult) => void
): Promise<EnhancedVisionResult> {
  const { 
    prompt = 'Describe salient objects and relations.',
    response_style = 'text',
    useSAM3 = true,
    useIsaac = true
  } = options;

  const result: EnhancedVisionResult = {
    detectedObjects: [],
    objectMasks: []
  };

  // Run SAM3 and Isaac in parallel for faster results
  const promises: Promise<any>[] = [];

  // 1. SAM3 Object Detection (fast, precise)
  if (useSAM3) {
    promises.push(
      detectObjects(imageUrl).then(objects => {
        result.detectedObjects = objects;
        if (onPartial) {
          onPartial({ ...result, partial: true });
        }
        return objects;
      }).catch(err => {
        console.warn('[Enhanced Vision] SAM3 detection failed:', err);
        return [];
      })
    );
  }

  // 2. Isaac Vision Analysis (semantic understanding) - Hon's eyes, must never fail
  if (useIsaac) {
    promises.push(
      analyzeWithIsaacStreaming(imageUrl, { prompt, response_style }, (isaacPartial) => {
        // Merge Isaac results into enhanced result
        Object.assign(result, isaacPartial);
        
        // Log what Isaac is sending to Hon
        if (isaacPartial?.output) {
          console.log(`[Isaac] 📤 Streaming to Hon: "${isaacPartial.output.substring(0, 150)}${isaacPartial.output.length > 150 ? '...' : ''}"`);
        }
        
        // Enhance Isaac output with SAM3-detected objects
        if (result.detectedObjects && result.detectedObjects.length > 0) {
          const objectsContext = result.detectedObjects.join(', ');
          if (result.output) {
            result.combinedAnalysis = `${result.output}\n\nDetected objects: ${objectsContext}`;
          } else {
            result.combinedAnalysis = `Detected objects: ${objectsContext}`;
          }
        } else {
          result.combinedAnalysis = result.output;
        }

        if (onPartial) {
          onPartial({ ...result, partial: isaacPartial.partial !== false });
        }
      }).then(isaacFinal => {
        // Final merge
        Object.assign(result, isaacFinal);
        if (isaacFinal?.output) {
          console.log(`[Isaac] ✅ Final analysis sent to Hon: "${isaacFinal.output.substring(0, 200)}${isaacFinal.output.length > 200 ? '...' : ''}"`);
        }
        return isaacFinal;
      }).catch(err => {
        // Isaac failed - log but don't break the system
        console.error('[Isaac] ❌ Vision analysis failed (non-critical):', err?.message || err);
        // Return empty result so system continues
        return { output: '', error: err?.message || 'Isaac analysis failed' };
      })
    );
  }

  await Promise.all(promises);

  // Final combined analysis
  if (result.detectedObjects && result.detectedObjects.length > 0 && result.output) {
    const objectsContext = result.detectedObjects.join(', ');
    result.combinedAnalysis = `${result.output}\n\nDetected objects: ${objectsContext}`;
  } else if (result.detectedObjects && result.detectedObjects.length > 0) {
    result.combinedAnalysis = `Detected objects: ${result.detectedObjects.join(', ')}`;
  } else {
    result.combinedAnalysis = result.output;
  }

  result.partial = false;
  if (onPartial) {
    onPartial(result);
  }

  return result;
}

/**
 * Enhanced vision with SAM3 mask context
 * Uses SAM3 masks to provide spatial context to vision analysis
 */
export async function analyzeWithSAM3Context(
  imageUrl: string,
  targetObject?: string,
  options: {
    prompt?: string;
    response_style?: 'text' | 'box' | 'point' | 'polygon';
  } = {}
): Promise<EnhancedVisionResult> {
  const { prompt, response_style = 'text' } = options;

  // If target object specified, enhance prompt with SAM3 mask context
  let enhancedPrompt = prompt || 'Describe salient objects and relations.';
  
  if (targetObject) {
    enhancedPrompt = `${enhancedPrompt} Focus on the ${targetObject} in the image.`;
  }

  // Run enhanced vision analysis
  return analyzeWithEnhancedVision(imageUrl, {
    prompt: enhancedPrompt,
    response_style,
    useSAM3: true,
    useIsaac: true
  });
}

/**
 * Get comprehensive vision analysis for a panel
 * Combines SAM3 detection + Isaac understanding for maximum awareness
 */
export async function getPanelEnhancedVision(
  panelId: string,
  options: {
    prompt?: string;
    response_style?: 'text' | 'box' | 'point' | 'polygon';
    targetObject?: string;
  } = {}
): Promise<EnhancedVisionResult> {
  const { useComicStore } = await import('../store/useComicStore');
  const state = useComicStore.getState();
  const page = state.currentPageIndex;
  const panel = state.currentComic?.pages[page]?.find(p => p.id === panelId);
  const imageUrl = panel?.url;

  if (!imageUrl) {
    return {
      error: 'Panel has no image URL',
      detectedObjects: [],
      combinedAnalysis: 'No image available'
    };
  }

  return analyzeWithSAM3Context(imageUrl, options.targetObject, {
    prompt: options.prompt,
    response_style: options.response_style
  });
}

