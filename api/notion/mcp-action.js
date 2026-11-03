import { withApiAccess } from "../_lib/api-access.js";
import { readProviderTokens } from '../_lib/oauth-state.js';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Extract user's Notion MCP token from cookies
 */
function getUserNotionToken(req) {
  const tokens = readProviderTokens(req, 'notion_mcp_tokens') || readProviderTokens(req, 'notion_tokens');
  return tokens?.access_token || null;
}

/**
 * Direct Notion API fallback when MCP fails
 */
async function notionApiFallback(intent, context, token) {
  const notionVersion = process.env.NOTION_API_VERSION || '2022-06-28';

  const notionFetch = async (path, opts) => {
    const resp = await fetch(`https://api.notion.com/v1${path}`, {
      ...opts,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': notionVersion,
        'Content-Type': 'application/json',
        ...(opts.headers || {})
      }
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json?.message || `notion_error_${resp.status}`);
    return json;
  };

  const intentLower = intent.toLowerCase();
  const actions = [];
  let summary = '';
  let pageId;

  // Check if this is just an "open" intent - don't create pages or add content
  const isJustOpen = /^(open|show|pull[_\s]?up|view|see|display)([_\s]+(my[_\s]+)?(notion|notes|workspace|panel))*$/i.test(intentLower);
  if (isJustOpen) {
    console.log('[MCP Fallback] Just open intent, no action needed');
    return { success: true, actions: [], summary: 'Panel opened.', pageId: null };
  }

  // Detect intent type - order matters!
  // Check for add/append to existing page FIRST (most specific)
  const isAddToPage = /add.*to.*page|append.*to|content.*to.*page|write.*to.*page/.test(intentLower) || 
                      (context?.pageId && /add|append|write|save|put|content|notes/.test(intentLower));
  const isSearchIntent = /search|find|look for|show me/.test(intentLower);
  // "Create...and add these ideas" should still create but also add content
  const hasInlineContent = /and\s+add\s+(these\s+)?(ideas|notes|content)?:?\s*/i.test(intent);
  const isCreateIntent = !isAddToPage && /create|new|start|make/.test(intentLower) && /page|notes|doc/.test(intentLower);
  
  console.log('[MCP Fallback] Intent analysis:', { isAddToPage, isSearchIntent, isCreateIntent, hasInlineContent, hasPageId: !!context?.pageId });

  // Helper to extract actual content from intent
  const extractContent = (intentStr) => {
    let content = intentStr
      // Remove common prefixes
      .replace(/^(add|append|write|save|put|create|new|start|make)\s*/gi, '')
      .replace(/\s*(content\s*)?(to\s*)?(current\s*)?(my\s*)?(the\s*)?(page|notion)\s*:?\s*/gi, ' ')
      .replace(/(notes?\s*page|new\s*page)\s*(and\s+)?/gi, '')
      .replace(/and\s+add\s+(these\s+)?(ideas|notes|content)?:?\s*/gi, '')
      .replace(/^[:\-–—_\s]+/, '')
      .trim();
    
    // Check if we have actual content (not just metadata words)
    const garbagePatterns = /^(_?notes?|page|content|ideas?|open|panel|append|add)$/i;
    if (!content || garbagePatterns.test(content)) {
      return null;
    }
    return content;
  };

  try {
    // Prioritize adding to existing page if we have a page context
    if (isAddToPage && context?.pageId) {
      // Add content to existing page - extract the actual content
      const content = extractContent(intent);
      
      if (!content) {
        // No actual content to add - just acknowledge
        console.log('[MCP Fallback] No content to add, skipping append');
        return { success: true, actions: [], summary: 'Ready to take notes.', pageId: context.pageId };
      }

      console.log('[MCP Fallback] Adding content to page:', context.pageId, 'Content:', content.substring(0, 100));

      await notionFetch(`/blocks/${context.pageId}/children`, {
        method: 'PATCH',
        body: JSON.stringify({
          children: [{
            object: 'block',
            type: 'paragraph',
            paragraph: { rich_text: [{ type: 'text', text: { content } }] }
          }]
        })
      });

      actions.push({ tool: 'notion_append_blocks', result: { added: 1 } });
      summary = `Added content to your Notion page.`;
      pageId = context.pageId;

    } else if (isSearchIntent) {
      // Extract search query
      const searchQuery = intent
        .replace(/search|find|look for|show me|in notion|from notion/gi, '')
        .trim();

      const result = await notionFetch('/search', {
        method: 'POST',
        body: JSON.stringify({
          query: searchQuery,
          page_size: 10
        })
      });

      const results = result.results || [];
      actions.push({ tool: 'notion_search', result: { count: results.length } });

      if (results.length > 0) {
        const titles = results.slice(0, 3).map((r) => {
          const title = r.properties?.title?.title?.[0]?.plain_text ||
                        r.properties?.Name?.title?.[0]?.plain_text ||
                        'Untitled';
          return title;
        }).join(', ');
        summary = `Found ${results.length} results. Top matches: ${titles}`;
        pageId = results[0]?.id;
      } else {
        summary = `No results found for "${searchQuery}".`;
      }

    } else if (isCreateIntent || !isSearchIntent) {
      // Extract title from intent if possible
      let title = 'Hon Notes';
      const titleMatch = intent.match(/(?:called|titled|named)\s+["']?([^"'\n]+)["']?/i);
      if (titleMatch) title = titleMatch[1].trim();
      else if (intent.includes('notes')) title = `Notes - ${new Date().toLocaleDateString()}`;

      // Get first available page as parent (workspace doesn't work for all accounts)
      let parentId = null;
      try {
        const searchResult = await notionFetch('/search', {
          method: 'POST',
          body: JSON.stringify({ page_size: 1 })
        });
        if (searchResult.results?.[0]) {
          parentId = searchResult.results[0].id;
        }
      } catch (e) {
        console.warn('[MCP Fallback] Could not find parent page:', e.message);
      }

      // Check if there's inline content to add (e.g., "Create page and add these ideas: ...")
      const inlineContent = hasInlineContent ? extractContent(intent) : null;
      const children = [];
      
      if (inlineContent) {
        console.log('[MCP Fallback] Adding inline content to new page:', inlineContent.substring(0, 100));
        children.push({
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: inlineContent } }] }
        });
      }

      // Create a new page with optional content
      const pagePayload = {
        properties: {
          title: {
            title: [{ type: 'text', text: { content: title } }]
          }
        },
        children
      };

      // Use parent page if found, otherwise try database parent
      if (parentId) {
        pagePayload.parent = { page_id: parentId };
      } else {
        // Last resort: try to find a database
        try {
          const dbSearch = await notionFetch('/search', {
            method: 'POST',
            body: JSON.stringify({ filter: { property: 'object', value: 'database' }, page_size: 1 })
          });
          if (dbSearch.results?.[0]) {
            pagePayload.parent = { database_id: dbSearch.results[0].id };
          }
        } catch {}
      }

      if (!pagePayload.parent) {
        throw new Error('Could not find a valid parent for the new page. Please ensure you have at least one page in your Notion workspace.');
      }

      const result = await notionFetch('/pages', {
        method: 'POST',
        body: JSON.stringify(pagePayload)
      });

      pageId = result.id;
      actions.push({ tool: 'notion_create_page', result: { id: pageId } });
      summary = inlineContent 
        ? `I've created a new notes page and added your content.`
        : `I've created a new notes page for you.`;
    }

    return { success: true, actions, summary, pageId };
  } catch (error) {
    console.error('[MCP Action Fallback] Error:', error);
    return {
      success: false,
      actions: [{ tool: 'fallback_error', error: error.message }],
      summary: `Failed to complete: ${error.message}`
    };
  }
}

/**
 * Extract actions and summary from Claude's MCP response
 */
function extractActionsFromResponse(response) {
  const actions = [];
  let summary = '';
  let pageId;

  for (const block of response.content || []) {
    if (block.type === 'text') {
      summary = block.text;
    } else if (block.type === 'mcp_tool_use') {
      actions.push({
        tool: block.name,
        server: block.server_name,
        input: block.input,
        id: block.id
      });
    } else if (block.type === 'mcp_tool_result') {
      // Parse tool results to extract page IDs, etc.
      try {
        const content = block.content?.[0]?.text;
        if (content) {
          const parsed = JSON.parse(content);
          if (parsed.id && parsed.object === 'page') {
            pageId = parsed.id;
          }
        }
      } catch {
        // Result might not be JSON
      }

      actions.push({
        tool_result: true,
        tool_use_id: block.tool_use_id,
        is_error: block.is_error,
        content: block.content
      });
    }
  }

  return { actions, summary, pageId };
}

 async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { intent, context } = req.body;

    if (!intent) {
      return res.status(400).json({ error: 'Intent is required' });
    }

    // Get user's Notion token
    const userToken = getUserNotionToken(req);

    if (!userToken) {
      return res.status(401).json({
        error: 'Not connected to Notion',
        needsAuth: true
      });
    }

    // Get Anthropic API key
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

    if (!apiKey) {
      console.error('[MCP Action] Missing Anthropic API key');
      return res.status(500).json({ error: 'API configuration error' });
    }

    const anthropic = new Anthropic({ apiKey });

    // Build context string
    const contextStr = context ? JSON.stringify(context, null, 2) : 'No additional context';

    console.log('[MCP Action] Processing intent:', intent);
    console.log('[MCP Action] Context:', contextStr);

    let mcpSucceeded = false;
    let mcpError = null;
    let response = null;

    // Try MCP Connector first (if available)
    try {
      // Call Claude with MCP Connector to Notion's official MCP server
      response = await anthropic.beta.messages.create({
        model: 'claude-sonnet-4-5-20250514',
        betas: ['mcp-client-2025-11-20'],
        max_tokens: 4096,
        mcp_servers: [{
          type: 'url',
          url: 'https://mcp.notion.com/mcp',
          name: 'notion',
          authorization_token: userToken
        }],
        tools: [{
          type: 'mcp_toolset',
          mcp_server_name: 'notion'
        }],
        system: `You are Hon, an AI assistant helping users manage their Notion workspace.

Your job is to execute the user's intent using Notion tools. Be efficient and precise.

IMPORTANT GUIDELINES:
- When asked to take notes or jot something down:
  1. Just write the notes directly - don't repeat them back or discuss them
  2. Use bulleted_list_item for points, to_do for tasks
  3. Work silently - the user sees the notes appear in their panel
  4. Do NOT summarize, explain, or confirm what you wrote after

- NEVER prefix content with labels like "content:", "notes:", "text:", etc.
- Write the actual content directly - no meta-labels
- Use the most appropriate Notion tool for the task
- Be concise - just execute, don't narrate

Available context:
${contextStr}`,
        messages: [{
          role: 'user',
          content: `Please help me with this Notion task: ${intent}`
        }]
      });

      console.log('[MCP Action] MCP Response received, stop_reason:', response.stop_reason);
      mcpSucceeded = true;
    } catch (err) {
      mcpError = err;
      console.warn('[MCP Action] MCP failed, falling back to direct API:', err.message);
    }

    // If MCP failed, use direct Notion API fallback
    if (!mcpSucceeded) {
      console.log('[MCP Action] Using direct Notion API fallback');
      const fallbackResult = await notionApiFallback(intent, context, userToken);

      return res.status(200).json({
        success: fallbackResult.success,
        actions: fallbackResult.actions,
        summary: fallbackResult.summary,
        pageId: fallbackResult.pageId,
        usedFallback: true
      });
    }

    // Extract actions and summary from MCP response
    const { actions, summary, pageId } = extractActionsFromResponse(response);

    // Generate a user-friendly summary if Claude didn't provide one
    let finalSummary = summary;
    if (!finalSummary || finalSummary.length < 10) {
      const toolsUsed = actions.filter(a => a.tool).map(a => a.tool);
      if (toolsUsed.includes('notion_create_page')) {
        finalSummary = "I've created a new page in your Notion.";
      } else if (toolsUsed.includes('notion_search')) {
        finalSummary = "I've searched your Notion workspace.";
      } else if (toolsUsed.includes('notion_append_blocks')) {
        finalSummary = "I've added content to your Notion page.";
      } else if (toolsUsed.includes('notion_update_page')) {
        finalSummary = "I've updated your Notion page.";
      } else {
        finalSummary = "Done! I've completed your Notion request.";
      }
    }

    return res.status(200).json({
      success: true,
      actions,
      summary: finalSummary,
      pageId,
      usage: response.usage
    });

  } catch (error) {
    console.error('[MCP Action] Error:', error);

    // Handle specific error types
    if (error.status === 401) {
      return res.status(401).json({
        error: 'Notion authorization expired',
        needsAuth: true
      });
    }

    // For MCP or connection errors, try the fallback
    if (error.message?.includes('mcp') || error.message?.includes('Connection') || error.message?.includes('Server error')) {
      console.log('[MCP Action] Attempting fallback after error:', error.message);

      try {
        const userToken = getUserNotionToken(req);
        if (userToken) {
          const { intent, context } = req.body;
          const fallbackResult = await notionApiFallback(intent, context, userToken);

          return res.status(200).json({
            success: fallbackResult.success,
            actions: fallbackResult.actions,
            summary: fallbackResult.summary,
            pageId: fallbackResult.pageId,
            usedFallback: true,
            originalError: error.message
          });
        }
      } catch (fallbackError) {
        console.error('[MCP Action] Fallback also failed:', fallbackError);
      }

      return res.status(502).json({
        error: 'Failed to connect to Notion',
        details: error.message
      });
    }

    return res.status(500).json({
      error: error.message || 'Failed to execute Notion action',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

export default withApiAccess(handler, "/api/notion/mcp-action");
