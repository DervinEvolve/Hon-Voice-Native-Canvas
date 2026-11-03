# Hon Tool System Architecture

This document describes how Hon's voice-AI tool system works, covering tool definitions, execution flow, and system prompts.

---

## Overview

Hon uses **Hume EVI (Empathic Voice Interface)** for real-time speech-to-speech communication. Tools allow Hon to take actions in the app based on voice commands.

**Architecture Summary:**
1. **Tool Definitions** → Configured in **Hume Dashboard** (JSON schemas)
2. **Tool Execution** → Handled in **`src/services/humeEviService.ts`** (client-side handlers)
3. **LLM System Prompt** → Configured in **Hume Dashboard** (describes Hon's personality + tool usage rules)

---

## 1. Tool Definitions (Hume Dashboard)

Each tool is defined in the Hume Dashboard with:
- **Tool Name**: Unique identifier (e.g., `canvas_editor_tool`)
- **Description**: When to use this tool
- **Parameters Schema**: JSON Schema defining expected parameters

### Example Tool Schema (for Hume Dashboard)

```json
{
  "name": "canvas_editor_tool",
  "description": "Generates or edits images on the canvas. Use this when the user wants to create a new image, edit an existing panel, or make visual changes to their artwork.",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["generate_image", "edit_image"],
        "description": "Whether to generate a new image or edit an existing one"
      },
      "prompt": {
        "type": "string",
        "description": "The image generation/editing prompt describing what to create or change"
      },
      "target_element_id": {
        "type": "string",
        "description": "Semantic ID of the panel to edit (e.g., 'panel-1', 'panel-2'). Required for edit_image action."
      },
      "output_parameters": {
        "type": "object",
        "properties": {
          "aspect_ratio": {
            "type": "string",
            "enum": ["1:1", "16:9", "9:16", "4:3", "3:4"],
            "description": "Aspect ratio for the generated image"
          }
        }
      }
    },
    "required": ["action", "prompt"]
  }
}
```

### Complete List of Hon's Tools

| Tool Name | Purpose | Key Parameters |
|-----------|---------|----------------|
| `getCanvasState` | Gets current canvas state (panels, positions) | `detail`: 'summary' \| 'focused' |
| `get_panel_vision` | Analyzes a panel image with AI vision | `target_element_id`, `query` |
| `canvas_editor_tool` | Generate/edit images | `action`, `prompt`, `target_element_id` |
| `video_generator` | Generate videos from text or images | `prompt`, `target_element_id`, `operation_type` |
| `aleph_video_editor` | Edit videos with Runway Aleph | `target_element_id`, `edit_prompt` |
| `getVideoContext` | Analyze video content | `target_element_id`, `query` |
| `add_sound_effects` | Add SFX to video panels | `target_element_id`, `sfx_descriptions` |
| `text_to_3d` | Generate 3D models from text | `prompt`, `mode`, `topology` |
| `memory_put` | Store a memory | `key`, `value`, `namespace` |
| `memory_get` | Retrieve a memory | `key`, `namespace` |
| `memory_search` | Search memories | `query`, `namespace`, `limit` |
| `memory_delete` | Delete a memory | `key`, `namespace` |
| `session_upsert` | Update session context | `data` |
| `session_get` | Get session context | - |
| `find_similar_panels` | Find visually similar panels | `target_element_id`, `threshold`, `limit` |
| `arrange_panels` | Arrange panels in layouts | `layout_type`: 'grid' \| 'timeline' \| 'storyboard' \| 'cluster' |
| `take_notes` | Start voice note-taking | `topic` |
| `stop_notes` | Stop note-taking | - |
| `notion_action` | Execute Notion commands | `intent`, `page_context`, `show_panel` |
| `generate_game` | Generate playable games | `game_idea`, `genre` |
| `edit_game` | Edit existing game | `edit_prompt` |
| `highlight_objects` | Highlight objects in panel | `target_element_id`, `objects` |
| `world_mode` | Switch to 3D world mode | `location`, `action` |
| `pc_execute` | Execute PlayCanvas code (with parallel build) | `intent` |
| `pc_look` | Visual scene understanding | `query` |

### pc_execute Tool Schema (Hume Dashboard)

```json
{
  "name": "pc_execute",
  "description": "Execute PlayCanvas scene building from natural language. Complex scenes (villages, cities, multi-element requests) are AUTOMATICALLY built in parallel by multiple AI agents for faster results. Just describe what you want - the system handles decomposition, parallel execution, and merging.",
  "parameters": {
    "type": "object",
    "properties": {
      "intent": {
        "type": "string",
        "description": "Natural language description of what to build. Be specific about elements, positions, and style. Complex requests trigger automatic parallel building."
      }
    },
    "required": ["intent"]
  }
}
```

**Parallel Build System:**
- Automatically triggered for complex scenes (villages, cities, forests with multiple elements)
- Decomposes into 2-6 independent sub-tasks with spatial zones
- Multiple AI agents generate code simultaneously
- Quality validation: completeness, entity creation, zone bounds, PBR materials
- Auto-retry on failure (1 retry per task)
- SSE streaming shows real-time progress ("Building 2/5 sections...")

---

## 2. Tool Execution (Client-Side Code)

### Connection Flow

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Hume Dashboard │───▶│  Backend API    │───▶│  Client App     │
│  (Tool Schemas) │    │  /api/hume/     │    │  humeEviService │
│  (System Prompt)│    │  generate-token │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Connecting to Hume EVI

**File: `src/services/humeEviService.ts`**

```typescript
// 1. Get access token and configId from backend
const { accessToken, configId } = await fetch('/api/hume/generate-token').then(r => r.json());

// 2. Connect to EVI
const tempClient = new HumeClient({ accessToken });
this.evi = await tempClient.empathicVoice.chat.connect({ configId });

// 3. Set up event handlers
this.setupEventHandlers();
```

### Processing Incoming Tool Calls

When Hume's LLM decides to use a tool, it sends a `tool_call` event:

```typescript
// In processIncomingMessage()
case 'tool_call':
  const toolCallId = event.tool_call_id;
  const toolName = event.name;
  const parameters = event.parameters;
  
  // Route to appropriate handler
  if (toolName === 'canvas_editor_tool') {
    this.handleCanvasEditorTool(toolCallId, parameters);
  } else if (toolName === 'video_generator') {
    this.handleVideoGeneratorTool(toolCallId, parameters);
  } else if (toolName === 'getCanvasState') {
    this.handleCanvasStateTool(toolCallId, parameters);
  }
  // ... more tool handlers
```

### Sending Tool Responses

After executing a tool, send the result back to Hume:

```typescript
// Success response
private sendToolSuccessResponse(toolCallId: string, message: string) {
  const successResponse = JSON.stringify({
    type: 'tool_response',
    tool_call_id: toolCallId,
    content: message  // JSON string with result data
  });
  this.evi.socket.send(successResponse);
  this.completeToolCall(toolCallId);
}

// Error response
private sendToolErrorResponse(toolCallId: string, errorMsg: string) {
  const errorResponse = JSON.stringify({
    type: 'tool_error',
    tool_call_id: toolCallId,
    error: errorMsg,
    content: `Error processing tool call ${toolCallId}`
  });
  this.evi.socket.send(errorResponse);
  this.completeToolCall(toolCallId);
}
```

### Example Tool Handler: `canvas_editor_tool`

```typescript
private async handleCanvasEditorTool(toolCallId: string, parameters: any) {
  // 1. Update visual indicator
  this.updateVisualIndicator(true, 'generating');
  
  try {
    // 2. Parse parameters
    const { action, prompt, target_element_id } = 
      typeof parameters === 'string' ? JSON.parse(parameters) : parameters;
    
    // 3. Execute the action
    if (action === 'generate_image') {
      const resultUrl = await fluxKreaService.generateWithStreaming(prompt, {
        image_size: 'landscape_4_3',
        num_inference_steps: 28
      }, (event) => {
        // Handle streaming progress
        console.log('Progress:', event.message);
      });
      
      // 4. Place image on canvas
      this.placeImageOnCanvas(resultUrl, target_element_id);
      
      // 5. Send success response
      this.sendToolSuccessResponse(toolCallId, JSON.stringify({
        success: true,
        imageUrl: resultUrl,
        action: 'generate_image'
      }));
      
    } else if (action === 'edit_image') {
      // Handle image editing...
    }
    
  } catch (error) {
    // 6. Send error response
    this.sendToolErrorResponse(toolCallId, error.message);
  } finally {
    // 7. Reset visual indicator
    this.updateVisualIndicator(true, 'idle');
  }
}
```

### Example Tool Handler: `video_generator`

```typescript
private async handleVideoGeneratorTool(toolCallId: string, parameters: any) {
  // 1. Show "dreaming" state for video generation
  this.updateVisualIndicator(true, 'dreaming');
  
  try {
    const { prompt, target_element_id, start_image_url, operation_type } = parameters;
    
    // 2. Determine if image-to-video or text-to-video
    const finalOperationType = start_image_url ? 'image_to_video' : 'text_to_video';
    
    // 3. Submit video generation request
    const requestId = await seedanceService.submitVideoGeneration({
      prompt,
      image_url: start_image_url,
      operation_type: finalOperationType
    });
    
    // 4. Poll for completion
    const result = await this.pollSeedanceVideoCompletion(requestId, toolCallId);
    
    // 5. Place video on canvas
    this.placeVideoOnCanvas(result.video_url, target_element_id);
    
    // 6. Send success response
    this.sendToolSuccessResponse(toolCallId, JSON.stringify({
      success: true,
      videoUrl: result.video_url
    }));
    
  } catch (error) {
    this.sendToolErrorResponse(toolCallId, error.message);
  }
}
```

---

## 3. LLM System Prompt (Hume Dashboard)

The system prompt is configured in the **Hume Dashboard** under your EVI configuration. It tells the AI:
- Who Hon is (personality, tone)
- What tools are available and when to use them
- Workflow rules (e.g., call `getCanvasState` before editing)

### Key System Prompt Sections

```
You are Hon, a creative AI assistant for a visual canvas application.

## Personality
- Friendly, encouraging, and creative
- Speaks naturally like a collaborator
- Celebrates user's creative work

## Tool Usage Rules

### Canvas Awareness
Before editing ANY panel, ALWAYS call getCanvasState first to understand:
- What panels exist and their positions
- Which panel is currently selected
- The semantic IDs (panel-1, panel-2, etc.)

### Image Generation
When user wants to create an image:
1. Call canvas_editor_tool with action="generate_image"
2. Include their description in the prompt parameter
3. Enhance vague prompts with artistic details

### Image Editing
When user wants to edit an existing image:
1. First call getCanvasState to identify the target panel
2. Then call canvas_editor_tool with:
   - action="edit_image"
   - target_element_id set to the panel's semantic ID
   - prompt describing the edit

### Video Generation
When user wants to create a video:
1. If from an image: use the selected panel's image as start_image_url
2. Call video_generator with appropriate operation_type
3. Inform user that video generation takes 1-2 minutes

### Panel Selection
- If user says "this panel" or "the selected one", use the currently selected panel
- If user references "panel 3" or "the third panel", map to semantic ID "panel-3"
- Always confirm which panel before making destructive edits

## Response Style
- Keep responses brief during tool execution
- Confirm actions naturally: "Creating that for you..." not "Executing tool..."
- Celebrate completed work: "There you go!" or "Looking good!"
```

---

## 4. Event Flow Diagram

```
User speaks "make this panel look like sunset"
           │
           ▼
┌──────────────────────┐
│    Hume EVI Cloud    │
│  (Speech-to-Text)    │
│  (LLM Processing)    │
└──────────┬───────────┘
           │ tool_call event
           │ {name: "canvas_editor_tool", 
           │  parameters: {action: "edit_image", prompt: "sunset", target_element_id: "panel-1"}}
           ▼
┌──────────────────────┐
│  humeEviService.ts   │
│  processIncomingMsg()│
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ handleCanvasEditor() │
│ - Parse params       │
│ - Call AI service    │
│ - Update canvas      │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ sendToolSuccess()    │
│ {type: "tool_response",
│  tool_call_id: "...",
│  content: "{success:true}"}
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│    Hume EVI Cloud    │
│  (LLM sees result)   │
│  (Generates response)│
└──────────┬───────────┘
           │ audio_output event
           ▼
Hon speaks: "Done! I've given it a beautiful sunset look."
```

---

## 5. Adding a New Tool

### Step 1: Define in Hume Dashboard

```json
{
  "name": "my_new_tool",
  "description": "Description of when to use this tool",
  "parameters": {
    "type": "object",
    "properties": {
      "param1": { "type": "string", "description": "..." },
      "param2": { "type": "number", "description": "..." }
    },
    "required": ["param1"]
  }
}
```

### Step 2: Add Handler in humeEviService.ts

```typescript
// In processIncomingMessage(), add routing:
} else if (event.name === 'my_new_tool') {
  this.handleMyNewTool(toolCallId, event.parameters);
}

// Add handler method:
private async handleMyNewTool(toolCallId: string, parameters: any) {
  try {
    const { param1, param2 } = typeof parameters === 'string' 
      ? JSON.parse(parameters) 
      : parameters;
    
    // Execute tool logic...
    const result = await doSomething(param1, param2);
    
    this.sendToolSuccessResponse(toolCallId, JSON.stringify({
      success: true,
      result
    }));
  } catch (error) {
    this.sendToolErrorResponse(toolCallId, error.message);
  }
}
```

### Step 3: Update System Prompt

Add usage instructions in the Hume Dashboard system prompt so the LLM knows when/how to use the tool.

---

## 6. Key Files Reference

| File | Purpose |
|------|---------|
| `src/services/humeEviService.ts` | Main EVI service - connection, tool handlers, message processing |
| `src/services/fluxKreaService.ts` | Image generation with streaming progress |
| `src/services/seedanceVideoService.ts` | Video generation |
| `src/services/meshyService.ts` | 3D model generation |
| `src/services/memoryService.ts` | User memory storage |
| `src/services/honEviSessionService.ts` | Session persistence |
| `src/store/useComicStore.ts` | Canvas state management |
| `/api/hume/generate-token` | Backend token + configId provider |

---

## 7. Visual Indicator States

The `updateVisualIndicator` method controls the Hon UI indicator:

| State | When Used |
|-------|-----------|
| `idle` | Default, ready for input |
| `listening` | Capturing user audio |
| `thinking` | Processing user intent |
| `processing` | Generic tool execution |
| `generating` | Image generation |
| `dreaming` | Video generation |
| `inspiring` | Playing audio response |
| `editing` | Video editing (Aleph) |

---

## 8. Important Patterns

### Always Parse Parameters

```typescript
const params = typeof parameters === 'string' 
  ? JSON.parse(parameters) 
  : parameters;
```

### Complete Tool Calls

Always call `completeToolCall(toolCallId)` or use the response helpers which do this automatically. Incomplete tool calls will cause the LLM to hang.

### Handle Long-Running Operations

For operations > 30 seconds, use the keepalive mechanism:

```typescript
this.beginExternalTask('dreaming');
// ... long operation
this.endExternalTask();
```

### Canvas State Freshness

Before editing, check if canvas state is fresh:

```typescript
const timeSinceCanvasState = Date.now() - this.lastCanvasStateCall;
if (timeSinceCanvasState > this.canvasStateCallThreshold) {
  await this.handleCanvasStateTool(`auto-refresh-${toolCallId}`, { _internalOnly: true });
}
```

---

## Summary

| Component | Location |
|-----------|----------|
| **Tool Schemas** | Hume Dashboard (JSON) |
| **System Prompt** | Hume Dashboard (text) |
| **Tool Execution** | `src/services/humeEviService.ts` |
| **AI Services** | `src/services/*.ts` (flux, seedance, meshy, etc.) |
| **State Management** | `src/store/useComicStore.ts` |
| **Backend Auth** | `/api/hume/generate-token` |

