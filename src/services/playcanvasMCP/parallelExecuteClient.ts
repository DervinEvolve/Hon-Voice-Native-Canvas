/**
 * Parallel Execute Client
 *
 * Client-side module for calling the parallel scene build API.
 * Provides a simple interface for the humeEviService to use.
 */

import { shouldDecompose, ParallelBuildProgress } from './parallelSceneTypes';

export interface ParallelExecuteResult {
  success: boolean;
  code: string;
  mode: 'parallel' | 'sequential';
  stats?: {
    totalTasks: number;
    successfulTasks: number;
    failedTasks: number;
    totalGenerationTime: number;
  };
  error?: string;
}

/**
 * Check if intent should use parallel execution
 */
export function needsParallelBuild(intent: string): boolean {
  return shouldDecompose(intent);
}

/**
 * Execute scene build with automatic parallel/sequential selection
 */
export async function executeSceneBuild(
  intent: string,
  sceneContext?: string,
  options: {
    mode?: 'auto' | 'parallel' | 'sequential';
    maxAgents?: number;
    onProgress?: (progress: ParallelBuildProgress) => void;
  } = {}
): Promise<ParallelExecuteResult> {
  const { mode = 'auto', maxAgents = 4, onProgress } = options;

  // Determine if we should use parallel execution
  const useParallel = mode === 'parallel' || (mode === 'auto' && shouldDecompose(intent));

  if (!useParallel) {
    // Use standard sequential execution
    // Clear any existing progress state first
    onProgress?.({
      buildId: 'sequential',
      phase: 'generating',
      completedTasks: 0,
      totalTasks: 1,
      message: 'Generating...',
    });

    const result = await executeSequential(intent, sceneContext);

    // Send complete event to clear UI state
    onProgress?.({
      buildId: 'complete',
      phase: result.success ? 'complete' : 'error',
      completedTasks: result.success ? 1 : 0,
      totalTasks: 1,
      message: result.success ? 'Done!' : (result.error || 'Failed'),
    });

    return result;
  }

  // Use parallel execution
  return executeParallel(intent, sceneContext, maxAgents, onProgress);
}

/**
 * Sequential execution via existing API
 */
async function executeSequential(
  intent: string,
  sceneContext?: string
): Promise<ParallelExecuteResult> {
  try {
    const response = await fetch('/api/playcanvas/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent, sceneContext }),
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        code: '',
        mode: 'sequential',
        error: error.error || 'Failed to generate code',
      };
    }

    const { code } = await response.json();

    return {
      success: true,
      code,
      mode: 'sequential',
    };
  } catch (error) {
    return {
      success: false,
      code: '',
      mode: 'sequential',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Estimate the number of parallel tasks based on intent complexity
 * This provides better UX feedback while waiting for the actual decomposition
 */
function estimateTaskCount(intent: string): number {
  const lower = intent.toLowerCase();

  // Count explicit list items (commas and "and")
  const commaCount = (lower.match(/,/g) || []).length;
  const andCount = (lower.match(/\band\b/g) || []).length;

  // Check for keywords that suggest multiple zones
  const zoneKeywords = ['village', 'town', 'city', 'kingdom', 'realm', 'world'];
  const hasZoneKeyword = zoneKeywords.some(kw => lower.includes(kw));

  // Check for area keywords
  const areaKeywords = ['forest', 'island', 'castle', 'mountain', 'beach', 'desert'];
  const areaCount = areaKeywords.filter(kw => lower.includes(kw)).length;

  // Base estimate
  let estimate = 2; // Minimum for parallel builds

  // Add for explicit items
  estimate += Math.min(commaCount, 3);
  estimate += Math.min(andCount, 2);

  // Add for zone/area complexity
  if (hasZoneKeyword) estimate += 2;
  estimate += Math.min(areaCount, 2);

  // Cap at reasonable max (server uses maxAgents=4 by default)
  return Math.min(Math.max(estimate, 2), 6);
}

/**
 * Parse SSE event from text
 */
function parseSSEEvent(text: string): { event: string; data: unknown } | null {
  const lines = text.split('\n');
  let event = '';
  let data = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      event = line.slice(7);
    } else if (line.startsWith('data: ')) {
      data = line.slice(6);
    }
  }

  if (event && data) {
    try {
      return { event, data: JSON.parse(data) };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Parallel execution via parallel-execute API with SSE streaming
 */
async function executeParallel(
  intent: string,
  sceneContext?: string,
  maxAgents: number = 4,
  onProgress?: (progress: ParallelBuildProgress) => void
): Promise<ParallelExecuteResult> {
  try {
    // Phase 1: Initializing - Spinning up agents
    onProgress?.({
      buildId: 'pending',
      phase: 'initializing',
      completedTasks: 0,
      totalTasks: 0,
      message: 'Spinning up build agents...',
    });

    // Estimate task count for better UX (will be corrected when API responds)
    const estimatedTasks = estimateTaskCount(intent);

    // Phase 2: After 500ms, show decomposing/planning
    const planningTimer = setTimeout(() => {
      onProgress?.({
        buildId: 'pending',
        phase: 'decomposing',
        completedTasks: 0,
        totalTasks: 0,
        message: 'Planning scene structure...',
      });
    }, 500);

    // Phase 3: After 1.5s, show distributing tasks
    const distributingTimer = setTimeout(() => {
      onProgress?.({
        buildId: 'pending',
        phase: 'distributing',
        completedTasks: 0,
        totalTasks: estimatedTasks,
        message: `Distributing ${estimatedTasks} tasks to agents...`,
      });
    }, 1500);

    // Phase 4: After 2.5s, show generating if still waiting
    const generatingTimer = setTimeout(() => {
      onProgress?.({
        buildId: 'pending',
        phase: 'generating',
        completedTasks: 0,
        totalTasks: estimatedTasks,
        message: `Building ${estimatedTasks} sections...`,
      });
    }, 2500);

    // Use streaming mode for real-time progress
    const response = await fetch('/api/playcanvas/parallel-execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent,
        sceneContext,
        mode: 'parallel',
        maxAgents,
        stream: true, // Enable SSE streaming
      }),
    });

    // Clear all progress phase timers
    clearTimeout(planningTimer);
    clearTimeout(distributingTimer);
    clearTimeout(generatingTimer);

    if (!response.ok) {
      let errorMsg = 'Parallel execution failed';
      try {
        const error = await response.json();
        errorMsg = error.error || errorMsg;
      } catch {
        // Response might not be JSON
      }

      onProgress?.({
        buildId: 'error',
        phase: 'error',
        completedTasks: 0,
        totalTasks: 0,
        message: errorMsg,
      });

      return {
        success: false,
        code: '',
        mode: 'parallel',
        error: errorMsg,
      };
    }

    // Handle SSE stream
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body for streaming');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: ParallelExecuteResult | null = null;

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete events from buffer
      const events = buffer.split('\n\n');
      buffer = events.pop() || ''; // Keep incomplete event in buffer

      for (const eventText of events) {
        if (!eventText.trim()) continue;

        const parsed = parseSSEEvent(eventText);
        if (!parsed) continue;

        const { event, data } = parsed;

        switch (event) {
          case 'decomposed':
            // Task decomposition complete - show distributing briefly, then generating
            const taskCount = (data as { totalTasks: number }).totalTasks;
            onProgress?.({
              buildId: 'distributing',
              phase: 'distributing',
              completedTasks: 0,
              totalTasks: taskCount,
              message: `Distributing ${taskCount} tasks to agents...`,
            });
            // After 800ms, show generating phase
            setTimeout(() => {
              onProgress?.({
                buildId: 'generating',
                phase: 'generating',
                completedTasks: 0,
                totalTasks: taskCount,
                message: `Building ${taskCount} sections...`,
              });
            }, 800);
            break;

          case 'progress':
            // Individual task completed - includes code OR toolCall for progressive rendering
            const progressData = data as {
              totalTasks: number;
              completedTasks: number;
              taskName: string;
              taskId: string;
              taskType: string;
              zoneName: string;
              success: boolean;
              code?: string | null;
              toolCall?: { tool: string; params: Record<string, unknown> };
              message: string;
            };
            onProgress?.({
              buildId: 'generating',
              phase: 'generating',
              completedTasks: progressData.completedTasks,
              totalTasks: progressData.totalTasks,
              message: progressData.message,
              // Pass code for immediate execution (geometry tasks)
              sectionCode: progressData.code || undefined,
              sectionName: progressData.taskName,
              sectionZone: progressData.zoneName,
              // Pass toolCall for immediate execution (particles/atmosphere/weather)
              sectionToolCall: progressData.toolCall || undefined,
            });
            break;

          case 'complete':
            // All tasks done
            const completeData = data as {
              success: boolean;
              mergedCode: string;
              stats: {
                totalTasks: number;
                successfulTasks: number;
                failedTasks: number;
                totalGenerationTime: number;
              };
            };

            onProgress?.({
              buildId: 'complete',
              phase: 'complete',
              completedTasks: completeData.stats.successfulTasks,
              totalTasks: completeData.stats.totalTasks,
              message: `Built ${completeData.stats.successfulTasks} sections successfully!`,
            });

            finalResult = {
              success: completeData.success,
              code: completeData.mergedCode,
              mode: 'parallel',
              stats: completeData.stats,
            };
            break;
        }
      }
    }

    if (finalResult) {
      return finalResult;
    }

    // Fallback if stream ended without complete event
    return {
      success: false,
      code: '',
      mode: 'parallel',
      error: 'Stream ended without completion',
    };

  } catch (error) {
    onProgress?.({
      buildId: 'error',
      phase: 'error',
      completedTasks: 0,
      totalTasks: 0,
      message: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      success: false,
      code: '',
      mode: 'parallel',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Format progress message for voice output
 */
export function getProgressVoiceMessage(progress: ParallelBuildProgress): string {
  switch (progress.phase) {
    case 'decomposing':
      return 'Planning the build...';
    case 'generating':
      if (progress.totalTasks > 1) {
        return `Building ${progress.totalTasks} sections simultaneously...`;
      }
      return 'Generating the scene...';
    case 'executing':
      return 'Assembling the scene...';
    case 'complete':
      if (progress.totalTasks > 1) {
        return `Done! Built ${progress.completedTasks} sections.`;
      }
      return 'Scene complete!';
    case 'error':
      return 'Something went wrong with the build.';
    default:
      return 'Working on it...';
  }
}
