/**
 * Parallel Scene Builder Service
 *
 * Orchestrates multi-agent scene building using the Manus-style "wide build" pattern.
 * Decomposes complex scene requests → dispatches parallel Claude calls → aggregates code.
 */

import {
  SpatialZone,
  SceneSubTask,
  SceneDecomposition,
  SceneCodeBlock,
  ParallelExecuteRequest,
  ParallelExecuteResponse,
  ParallelBuildProgress,
  ParallelBuilderConfig,
  DEFAULT_PARALLEL_CONFIG,
  ZONE_TEMPLATES,
  shouldDecompose,
} from './parallelSceneTypes';

/** Generate unique build ID */
const generateBuildId = () => `build_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** Generate unique task ID */
const generateTaskId = () => `task_${Math.random().toString(36).slice(2, 10)}`;

/**
 * System prompt for scene decomposition
 * Claude analyzes the intent and breaks it into spatial sub-tasks
 */
const DECOMPOSITION_PROMPT = `You are a scene architect that decomposes complex 3D scene requests into parallel sub-tasks.

Given a user's scene request, analyze it and output a JSON decomposition plan.

RULES:
1. Each sub-task should be INDEPENDENT and executable in isolation
2. Assign spatial zones to prevent entity collisions (use x/z coordinates)
3. Priority 0 = environment/ground, 1 = major structures, 2 = details/props
4. Keep sub-tasks focused - one area or one type of element each
5. Minimum 2 tasks, maximum 6 tasks for parallel efficiency

OUTPUT FORMAT (JSON only, no markdown):
{
  "plan": "Brief description of the overall build strategy",
  "isComplex": true,
  "subTasks": [
    {
      "id": "task_1",
      "name": "Ground and Environment",
      "description": "Create the ground plane, roads, and base environment",
      "zone": {
        "id": "center",
        "name": "Central Area",
        "bounds": { "minX": -50, "maxX": 50, "minZ": -50, "maxZ": 50 }
      },
      "priority": 0,
      "dependencies": []
    },
    {
      "id": "task_2",
      "name": "North Buildings",
      "description": "Create buildings in the northern section",
      "zone": {
        "id": "north",
        "name": "North Zone",
        "bounds": { "minX": -40, "maxX": 40, "minZ": 20, "maxZ": 50 }
      },
      "priority": 1,
      "dependencies": ["task_1"]
    }
  ]
}

ZONE ASSIGNMENT STRATEGIES:
- Village/Town: Use quadrant zones (NW, NE, SW, SE)
- Street/Linear: Use linear zones (left, center, right)
- Plaza/Circular: Use radial zones (center, north, south, east, west)
- Forest/Nature: Scatter zones with buffer space between

For simple requests (single object, basic scene), return:
{
  "plan": "Simple single-task execution",
  "isComplex": false,
  "subTasks": []
}`;

/**
 * Generate zone-constrained system prompt for sub-agent
 */
function getZoneConstrainedPrompt(basePrompt: string, zone?: SpatialZone): string {
  if (!zone) return basePrompt;

  const zoneInstructions = `
SPATIAL ZONE CONSTRAINT:
You MUST place ALL entities within this zone:
- Zone: ${zone.name} (${zone.id})
- X range: ${zone.bounds.minX} to ${zone.bounds.maxX}
- Z range: ${zone.bounds.minZ} to ${zone.bounds.maxZ}
- Y: Place objects at appropriate heights (ground is y=0)

CRITICAL: Do NOT place any entities outside these bounds.
Calculate positions within the zone using:
  x = ${zone.bounds.minX} + (random * ${zone.bounds.maxX - zone.bounds.minX})
  z = ${zone.bounds.minZ} + (random * ${zone.bounds.maxZ - zone.bounds.minZ})
`;

  return basePrompt + '\n' + zoneInstructions;
}

/**
 * Parallel Scene Builder
 */
export class ParallelSceneBuilder {
  private config: ParallelBuilderConfig;
  private progressCallback?: (progress: ParallelBuildProgress) => void;
  private buildId: string = '';

  constructor(config: Partial<ParallelBuilderConfig> = {}) {
    this.config = { ...DEFAULT_PARALLEL_CONFIG, ...config };
  }

  /** Set progress callback for build events */
  onProgress(callback: (progress: ParallelBuildProgress) => void): void {
    this.progressCallback = callback;
  }

  /** Emit progress event */
  private emitProgress(
    phase: ParallelBuildProgress['phase'],
    completedTasks: number,
    totalTasks: number,
    currentTask?: string,
    message?: string
  ): void {
    if (this.progressCallback) {
      this.progressCallback({
        buildId: this.buildId,
        phase,
        completedTasks,
        totalTasks,
        currentTask,
        message,
      });
    }
  }

  /**
   * Decompose intent into sub-tasks using Claude
   */
  async decomposeIntent(intent: string): Promise<SceneDecomposition> {
    // Quick check - if intent is simple, skip decomposition
    if (!shouldDecompose(intent)) {
      return {
        plan: 'Simple request - direct execution',
        isComplex: false,
        subTasks: [],
      };
    }

    const response = await fetch('/api/playcanvas/decompose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent }),
    });

    if (!response.ok) {
      console.error('[ParallelBuilder] Decomposition failed:', await response.text());
      // Fallback to simple execution
      return {
        plan: 'Decomposition failed - falling back to single execution',
        isComplex: false,
        subTasks: [],
      };
    }

    const data = await response.json();
    return data.decomposition;
  }

  /**
   * Execute a single sub-task with zone constraints
   */
  async executeSubTask(
    task: SceneSubTask,
    intent: string,
    baseSystemPrompt: string,
    sceneContext?: string
  ): Promise<SceneCodeBlock> {
    const startTime = Date.now();

    try {
      // Build zone-constrained task description
      const taskPrompt = `
SUB-TASK: ${task.name}
DESCRIPTION: ${task.description}
OVERALL SCENE: ${intent}

Generate ONLY the code for this specific sub-task. Focus on:
${task.description}

${sceneContext ? `EXISTING SCENE CONTEXT:\n${sceneContext}` : ''}
`;

      const response = await fetch('/api/playcanvas/execute-subtask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: taskPrompt,
          zone: task.zone,
          taskId: task.id,
          sceneContext,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          taskId: task.id,
          taskName: task.name,
          code: '',
          zone: task.zone,
          success: false,
          error: `API error: ${errorText}`,
          generationTime: Date.now() - startTime,
        };
      }

      const data = await response.json();

      return {
        taskId: task.id,
        taskName: task.name,
        code: data.code || '',
        zone: task.zone,
        success: true,
        generationTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        taskId: task.id,
        taskName: task.name,
        code: '',
        zone: task.zone,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        generationTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute tasks in parallel batches
   */
  async executeParallel(
    tasks: SceneSubTask[],
    intent: string,
    baseSystemPrompt: string,
    sceneContext?: string
  ): Promise<SceneCodeBlock[]> {
    const results: SceneCodeBlock[] = [];

    // Group tasks by priority
    const tasksByPriority = new Map<number, SceneSubTask[]>();
    for (const task of tasks) {
      const priority = task.priority;
      if (!tasksByPriority.has(priority)) {
        tasksByPriority.set(priority, []);
      }
      tasksByPriority.get(priority)!.push(task);
    }

    // Sort priorities
    const priorities = Array.from(tasksByPriority.keys()).sort((a, b) => a - b);

    let completedCount = 0;

    // Execute each priority level in sequence, but tasks within a level in parallel
    for (const priority of priorities) {
      const priorityTasks = tasksByPriority.get(priority)!;

      // Limit concurrent agents
      const batches: SceneSubTask[][] = [];
      for (let i = 0; i < priorityTasks.length; i += this.config.maxConcurrentAgents) {
        batches.push(priorityTasks.slice(i, i + this.config.maxConcurrentAgents));
      }

      for (const batch of batches) {
        // Execute batch in parallel
        const batchPromises = batch.map(task => {
          this.emitProgress(
            'generating',
            completedCount,
            tasks.length,
            task.name,
            `Generating: ${task.name}`
          );

          return this.executeSubTask(task, intent, baseSystemPrompt, sceneContext);
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        completedCount += batch.length;
      }
    }

    return results;
  }

  /**
   * Merge code blocks into single executable code
   */
  mergeCodeBlocks(blocks: SceneCodeBlock[]): string {
    const successBlocks = blocks.filter(b => b.success && b.code);

    if (successBlocks.length === 0) {
      return '// No code generated';
    }

    // Sort by task priority (environment first, then structures, then details)
    const sortedBlocks = [...successBlocks].sort((a, b) => {
      // Extract priority from taskId if available
      const aPriority = parseInt(a.taskId.split('_')[1]) || 0;
      const bPriority = parseInt(b.taskId.split('_')[1]) || 0;
      return aPriority - bPriority;
    });

    const mergedCode = sortedBlocks.map(block => `
// === ${block.taskName} ===
// Zone: ${block.zone?.name || 'global'}
${block.code}
`).join('\n');

    return mergedCode;
  }

  /**
   * Main execution method - handles both parallel and sequential modes
   */
  async execute(request: ParallelExecuteRequest): Promise<ParallelExecuteResponse> {
    const startTime = Date.now();
    this.buildId = generateBuildId();

    this.emitProgress('decomposing', 0, 0, undefined, 'Analyzing scene request...');

    try {
      // Step 1: Determine if we need parallel execution
      let decomposition: SceneDecomposition;

      if (request.mode === 'sequential') {
        decomposition = { plan: 'Sequential mode', isComplex: false, subTasks: [] };
      } else if (request.mode === 'parallel') {
        decomposition = await this.decomposeIntent(request.intent);
      } else {
        // Auto mode - let Claude decide
        decomposition = await this.decomposeIntent(request.intent);
      }

      // Step 2: Execute based on complexity
      if (!decomposition.isComplex || decomposition.subTasks.length < this.config.minTasksForParallel) {
        // Simple execution - single call to existing API
        this.emitProgress('generating', 0, 1, 'Single execution', 'Generating scene...');

        const response = await fetch('/api/playcanvas/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: request.intent,
            sceneContext: request.sceneContext,
          }),
        });

        if (!response.ok) {
          throw new Error(`Execute API error: ${await response.text()}`);
        }

        const data = await response.json();

        this.emitProgress('complete', 1, 1, undefined, 'Scene generated!');

        return {
          success: true,
          mode: 'sequential',
          blocks: [{
            taskId: 'single',
            taskName: 'Full Scene',
            code: data.code,
            success: true,
            generationTime: Date.now() - startTime,
          }],
          totalTime: Date.now() - startTime,
        };
      }

      // Step 3: Parallel execution
      this.emitProgress(
        'generating',
        0,
        decomposition.subTasks.length,
        undefined,
        `Building ${decomposition.subTasks.length} scene sections in parallel...`
      );

      // Apply pre-defined zones if provided
      let tasks = decomposition.subTasks;
      if (request.zones && request.zones.length > 0) {
        tasks = tasks.map((task, i) => ({
          ...task,
          zone: request.zones![i % request.zones!.length],
        }));
      }

      // Execute all tasks in parallel
      const blocks = await this.executeParallel(
        tasks,
        request.intent,
        '', // Base prompt comes from API
        request.sceneContext
      );

      // Step 4: Aggregate results
      this.emitProgress('executing', blocks.length, blocks.length, undefined, 'Merging scene code...');

      const successCount = blocks.filter(b => b.success).length;
      const mergedCode = this.mergeCodeBlocks(blocks);

      this.emitProgress('complete', blocks.length, blocks.length, undefined,
        `Built ${successCount}/${blocks.length} sections successfully!`);

      return {
        success: successCount > 0,
        mode: 'parallel',
        decomposition,
        blocks,
        totalTime: Date.now() - startTime,
        error: successCount === 0 ? 'All sub-tasks failed' : undefined,
      };

    } catch (error) {
      this.emitProgress('error', 0, 0, undefined,
        error instanceof Error ? error.message : 'Build failed');

      return {
        success: false,
        mode: 'sequential',
        blocks: [],
        totalTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get suggested zone template based on intent keywords
   */
  static suggestZoneTemplate(intent: string): SpatialZone[] {
    const lower = intent.toLowerCase();

    if (lower.includes('street') || lower.includes('road') || lower.includes('linear')) {
      return ZONE_TEMPLATES.linear as unknown as SpatialZone[];
    }

    if (lower.includes('plaza') || lower.includes('square') || lower.includes('circular')) {
      return ZONE_TEMPLATES.radial as unknown as SpatialZone[];
    }

    // Default to quadrant for villages, towns, forests, etc.
    return ZONE_TEMPLATES.quadrant as unknown as SpatialZone[];
  }
}

/** Singleton instance for easy import */
export const parallelBuilder = new ParallelSceneBuilder();
