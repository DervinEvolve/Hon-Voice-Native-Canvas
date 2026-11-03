/**
 * PlayCanvas MCP Server
 * 
 * A Model Context Protocol-style server for AI control of PlayCanvas scenes.
 * Provides a standardized tool interface for Hon to manipulate immersive scenes.
 * 
 * Architecture:
 * - Tool Registry: Defines available tools with schemas
 * - Tool Handlers: Execute actions on PlayCanvas app
 * - Scene Bridge: Connects to WorldImmersiveCanvas
 * 
 * Inspired by: https://github.com/playcanvas/editor-mcp-server
 */

import { entityTools } from './tools/entities';
import { componentTools } from './tools/components';
import { environmentTools } from './tools/environment';
import { queryTools } from './tools/queries';

// PlayCanvas app reference (set by WorldImmersiveCanvas)
let playCanvasApp: any = null;
let cameraEntity: any = null;

/**
 * Tool definition following MCP schema
 */
export interface MCPTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      default?: any;
    }>;
    required?: string[];
  };
  handler: (params: any, app: any, camera: any) => Promise<MCPToolResult> | MCPToolResult;
}

/**
 * Tool execution result
 */
export interface MCPToolResult {
  success: boolean;
  message?: string;
  data?: any;
  error?: string;
}

/**
 * All registered tools
 */
const toolRegistry: Map<string, MCPTool> = new Map();

/**
 * Register a tool
 */
export function registerTool(tool: MCPTool): void {
  toolRegistry.set(tool.name, tool);
}

/**
 * Get all registered tools (for Hume schema generation)
 */
export function getRegisteredTools(): MCPTool[] {
  return Array.from(toolRegistry.values());
}

/**
 * Get tool by name
 */
export function getTool(name: string): MCPTool | undefined {
  return toolRegistry.get(name);
}

/**
 * Set the PlayCanvas app reference
 */
export function setPlayCanvasApp(app: any, camera?: any): void {
  playCanvasApp = app;
  cameraEntity = camera;
  console.log('[PlayCanvasMCP] App connected');
}

/**
 * Get the PlayCanvas app reference
 */
export function getPlayCanvasApp(): any {
  return playCanvasApp;
}

/**
 * Get the camera entity
 */
export function getCameraEntity(): any {
  return cameraEntity;
}

/**
 * Check if MCP is connected to a PlayCanvas app
 */
export function isConnected(): boolean {
  return playCanvasApp !== null;
}

/**
 * Execute a tool by name
 */
export async function executeTool(
  toolName: string, 
  params: Record<string, any>
): Promise<MCPToolResult> {
  const tool = toolRegistry.get(toolName);
  
  if (!tool) {
    return {
      success: false,
      error: `Unknown tool: ${toolName}. Available tools: ${Array.from(toolRegistry.keys()).join(', ')}`
    };
  }
  
  if (!playCanvasApp) {
    return {
      success: false,
      error: 'PlayCanvas app not connected. Immersive scene mode may not be active.'
    };
  }
  
  try {
    console.log(`[PlayCanvasMCP] Executing tool: ${toolName}`, params);
    const result = await tool.handler(params, playCanvasApp, cameraEntity);
    console.log(`[PlayCanvasMCP] Tool result:`, result);
    return result;
  } catch (err) {
    console.error(`[PlayCanvasMCP] Tool error:`, err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error executing tool'
    };
  }
}

/**
 * Generate Hume-compatible tool schemas
 */
export function generateHumeSchemas(): Array<{
  name: string;
  description: string;
  parameters: object;
}> {
  return getRegisteredTools().map(tool => ({
    name: `pc_${tool.name}`,
    description: tool.description,
    parameters: tool.parameters
  }));
}

/**
 * Execute multiple tools in sequence with delays for visual effect
 * This allows Hon to "build" scenes visibly
 */
export async function executeToolSequence(
  commands: Array<{ tool: string; params: Record<string, any>; delay?: number }>,
  onProgress?: (step: number, total: number, result: MCPToolResult) => void
): Promise<{ success: boolean; results: MCPToolResult[] }> {
  const results: MCPToolResult[] = [];
  
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const result = await executeTool(cmd.tool, cmd.params);
    results.push(result);
    
    if (onProgress) {
      onProgress(i + 1, commands.length, result);
    }
    
    // Add delay between commands for visual effect (default 200ms)
    if (cmd.delay !== 0 && i < commands.length - 1) {
      await new Promise(resolve => setTimeout(resolve, cmd.delay || 200));
    }
    
    // Stop on error unless it's a non-critical failure
    if (!result.success && result.error?.includes('not found')) {
      console.warn(`[PlayCanvasMCP] Non-critical error, continuing:`, result.error);
    } else if (!result.success) {
      return { success: false, results };
    }
  }
  
  return { success: true, results };
}

// NOTE: The legacy scene_command and build_scene tools have been removed.
// All scene building should now go through pc_execute which uses Claude to generate
// proper PlayCanvas code with access to our grass and character systems.
// 
// pc_execute: Universal scene control via natural language
// - Supports grass system: app.fire('hon:add-grass', { style: 'forest' })
// - Supports characters: app.fire('hon:spawn-character', { characterId: 'soldier', isPlayer: true })
// - Full PlayCanvas API access for custom scenes

/**
 * Initialize all tools
 */
export function initializeMCP(): void {
  // Register entity tools
  entityTools.forEach(registerTool);
  
  // Register component tools
  componentTools.forEach(registerTool);
  
  // Register environment tools
  environmentTools.forEach(registerTool);
  
  // Register query tools
  queryTools.forEach(registerTool);
  
  // NOTE: Legacy sceneCommandTool and buildSceneTool removed - use pc_execute instead
  
  console.log(`[PlayCanvasMCP] Initialized with ${toolRegistry.size} tools`);
}

// Auto-initialize on import
initializeMCP();

// Export for external use
export { entityTools, componentTools, environmentTools, queryTools };

