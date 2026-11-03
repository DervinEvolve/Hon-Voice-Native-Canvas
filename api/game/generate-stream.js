import { withApiAccess } from "../_lib/api-access.js";
import { ownedApiCall } from '../_lib/api-access.js';
import { detectGameType, getTemplate, getModelLoadingCode } from '../../src/lib/gameTemplates.js';
import { validateGameCode } from '../../src/lib/validateGame.js';
import { ENHANCED_SYSTEM_PROMPT, generateEnhancedPrompt } from '../../src/lib/gamePrompts.js';
import { requestStructuredGeminiGame } from '../../src/lib/gemini3StructuredRequest.js';

export const config = {
  maxDuration: 300
};

function stripDisallowedGlobals(code) {
  if (!code) return code;
  const patterns = [
    /(?:const|let|var)\s+scene\s*=\s*new\s+THREE\.Scene\([^;]*\);?/gi,
    /(?:const|let|var)\s+camera\s*=\s*new\s+THREE\.PerspectiveCamera\([^;]*\);?/gi,
    /(?:const|let|var)\s+camera\s*=\s*new\s+THREE\.OrthographicCamera\([^;]*\);?/gi,
    /(?:const|let|var)\s+renderer\s*=\s*new\s+THREE\.WebGLRenderer\([^;]*\);?/gi,
    /document\.body\.appendChild\s*\(\s*renderer\.domElement\s*\);?/gi
  ];
  let cleaned = code;
  for (const pattern of patterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned;
}

 async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { description, prompt, temperature = 0.4, provider = 'anthropic', model, options = {}, customAssets = {} } = req.body;
    const gameDescription = description || prompt;
    const requestId = req.headers['x-request-id'] || `game-stream_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    if (!gameDescription || typeof gameDescription !== 'string') {
      return res.status(400).json({ error: 'Description or prompt required' });
    }

    // Check if custom 3D assets are provided
    const hasCustomAssets = customAssets && typeof customAssets === 'object' && Object.keys(customAssets).length > 0;
    if (hasCustomAssets) {
      console.log(`[game.generate-stream][${requestId}] Custom 3D assets provided:`, Object.keys(customAssets));
    }

    console.log(`[game.generate-stream][${requestId}] Start: provider=${provider} desc.len=${gameDescription.length}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const sendStatus = (text, phase) => {
      res.write(`data: ${JSON.stringify({ event: 'status', text, phase })}\n\n`);
    };

    // Detect game type early
    const gameType = detectGameType(gameDescription);
    console.log(`[game.generate-stream][${requestId}] Detected game type: ${gameType}`);

    // For Claude, use the template-based system prompt
    // For Gemini 3, we'll use the creative prompt (set below)
    const claudeSystemPrompt = ENHANCED_SYSTEM_PROMPT;
    console.log(`[game.generate-stream][${requestId}] System prompt loaded, length: ${claudeSystemPrompt?.length || 0}`);
    
    // Safety check: if prompt didn't load, fall back to template immediately
    if (!claudeSystemPrompt || claudeSystemPrompt.length < 1000) {
      console.error(`[game.generate-stream][${requestId}] System prompt failed to load! Using template fallback.`);
      let templateCode = getTemplate(gameType, gameDescription);
      // Inject custom 3D model loading code if provided
      if (hasCustomAssets) {
        const modelLoadingCode = getModelLoadingCode(customAssets);
        templateCode = modelLoadingCode + '\n' + templateCode;
      }
      res.write(`data: ${JSON.stringify({ event: 'delta', text: templateCode })}\n\n`);
      res.write(`data: ${JSON.stringify({ event: 'done', done: true, source: 'template', gameType })}\n\n`);
      return res.end();
    }

    let providerName = String(provider || '').toLowerCase();
    let accumulatedText = '';
    let geminiSucceeded = false;
    let cacheCreated = 0;
    let cacheRead = 0;
    let selectedModel = null;
    let streamStarted = false;
    let geminiSpecMetadata = null;

    // Handle Gemini 3 Pro generation (if requested or default)
    if (providerName === 'gemini' || providerName === 'gemini3' || !providerName) {
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        console.error(`[game.generate-stream][${requestId}] GEMINI_API_KEY not found, falling back to Claude`);
        providerName = 'claude';
      } else {
        console.log(`[game.generate-stream][${requestId}] Using Gemini 3 Pro structured pipeline`);
        try {
          const chunkTracker = (() => {
            let lastEmit = 0;
            let total = 0;
            return (chunkText = '') => {
              total += chunkText.length;
              const now = Date.now();
              if (now - lastEmit > 500) {
                sendStatus(`Gemini 3 streaming… (${total} chars)`, 'gemini_chunk');
                lastEmit = now;
              }
            };
          })();

          const { code: structuredCode, spec } = await requestStructuredGeminiGame({
            description: gameDescription,
            customAssets,
            temperature: options.temperature ?? 0.75,
            maxTokens: options.max_tokens ?? 4096,
            requestId,
            onAttempt: (attempt) => {
              const msg = attempt === 1
                ? 'Gemini 3 is assembling your game...'
                : `Gemini schema retry (${attempt}/2)...`;
              sendStatus(msg, 'model_setup');
            },
            onChunk: chunkTracker
          });

          geminiSpecMetadata = spec?.metadata || null;
          accumulatedText = structuredCode;
          const chunkSize = Number(options.chunkSize) > 0 ? Number(options.chunkSize) : 900;

          if (!streamStarted) {
            sendStatus('Streaming code...', 'streaming');
            streamStarted = true;
          }

          for (let offset = 0; offset < structuredCode.length; offset += chunkSize) {
            const slice = structuredCode.slice(offset, offset + chunkSize);
            res.write(`data: ${JSON.stringify({ event: 'delta', text: slice })}\n\n`);
          }

          console.log(`[game.generate-stream][${requestId}] Gemini 3 structured generation complete, ${structuredCode.length} chars`);
          geminiSucceeded = true;
          selectedModel = model || 'gemini-3-pro';
        } catch (error) {
          console.error(`[game.generate-stream][${requestId}] Gemini 3 generation failed:`, error.message || error);
          sendStatus('Gemini 3 failed, falling back to Claude...', 'model_switch');
          providerName = 'claude';
          accumulatedText = '';
        }
      }
    }
    
    // Claude generation (either requested or fallback from Gemini)
    if (!geminiSucceeded && (providerName === 'claude' || providerName === 'anthropic' || !providerName)) {
      sendStatus(geminiSucceeded ? 'Using Claude for validation...' : 'Falling back to Claude...', 'model_switch');
      const preferModel = process.env.CLAUDE_MODEL || model || options.model;
      const modelCandidates = [
        preferModel,
        'claude-sonnet-4-5-20250929',
        'claude-3-5-sonnet-20241022'
      ].filter(Boolean);

      const basePayload = {
        temperature: options.temperature ?? temperature,
        max_tokens: options.max_tokens ?? 16000, // Increased from 4000 to prevent incomplete code
        system: [
          {
            type: "text",
            text: claudeSystemPrompt,
            cache_control: { type: "ephemeral" }
          }
        ],
        messages: [
          { 
            role: 'user', 
            content: generateEnhancedPrompt(gameDescription, customAssets)
          }
        ],
        stream: true
      };

      let apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
      
      if (!apiKey) {
        console.log(`[game.generate-stream][${requestId}] Checking for split API key...`);
        const parts = [
          process.env.CLAUDE_API_KEY_PART1,
          process.env.CLAUDE_API_KEY_PART2,
          process.env.CLAUDE_API_KEY_PART3
        ].filter(Boolean);
        
        if (parts.length === 3) {
          apiKey = parts.join('');
          console.log(`[game.generate-stream][${requestId}] Using combined API key from ${parts.length} parts`);
        }
      }
      
      if (!apiKey) {
        console.error(`[game.generate-stream][${requestId}] No API key found`);
        res.write(`data: ${JSON.stringify({ error: 'API key missing' })}\n\n`);
        return res.end();
      }

      let response = null;

      // Try models in order
      for (const tryModel of modelCandidates) {
        try {
          console.log(`[game.generate-stream][${requestId}] Trying model: ${tryModel}`);
          
          const modelPayload = { ...basePayload, model: tryModel };
          
          response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-beta': 'prompt-caching-2024-07-31'
            },
            body: JSON.stringify(modelPayload)
          });

          if (response.ok) {
            selectedModel = tryModel;
            console.log(`[game.generate-stream][${requestId}] Success with model: ${tryModel}`);
            break;
          }

          const errorData = await response.json();
          console.warn(`[game.generate-stream][${requestId}] Model ${tryModel} failed:`, errorData.error?.message || 'Unknown error');
          
        } catch (error) {
          console.error(`[game.generate-stream][${requestId}] Error with model ${tryModel}:`, error.message);
        }
      }

      if (!response || !response.ok) {
        console.error(`[game.generate-stream][${requestId}] All models failed, using template fallback`);
        
        // Fall back to template
        const templateCode = getTemplate(gameType, gameDescription);
        res.write(`data: ${JSON.stringify({ event: 'delta', text: templateCode })}\n\n`);
        res.write(`data: ${JSON.stringify({ event: 'done', done: true, source: 'template', gameType })}\n\n`);
        return res.end();
      }

      // Stream the response to frontend in real-time
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        // STEP 1: Stream Claude's output to frontend in real-time
        let eventCount = 0;
        let deltaCount = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log(`[game.generate-stream][${requestId}] Stream ended. Events: ${eventCount}, Deltas: ${deltaCount}, Total chars: ${accumulatedText.length}`);
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                eventCount++;
                
                // Log event types for debugging
                if (eventCount <= 5 || parsed.type === 'content_block_delta') {
                  console.log(`[game.generate-stream][${requestId}] Event ${eventCount}: type=${parsed.type}, has_delta=${!!parsed.delta}, has_text=${!!parsed.delta?.text}`);
                }
                
                // Track cache usage
                if (parsed.usage) {
                  cacheCreated = parsed.usage.cache_creation_input_tokens || 0;
                  cacheRead = parsed.usage.cache_read_input_tokens || 0;
                  console.log(`[game.generate-stream][${requestId}] Cache usage: created=${cacheCreated}, read=${cacheRead}`);
                }
                
                // Stream to frontend immediately
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                  deltaCount++;
                  if (!streamStarted) {
                    sendStatus('Streaming code...', 'streaming');
                    streamStarted = true;
                  }
                  accumulatedText += parsed.delta.text;
                  res.write(`data: ${JSON.stringify({ event: 'delta', text: parsed.delta.text })}\n\n`);
                }
              } catch (e) {
                console.warn(`[game.generate-stream][${requestId}] Failed to parse:`, data.substring(0, 100));
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    }

    // Common post-processing for both providers
    try {

      // Clean up generated code
      let cleanedCode = accumulatedText
        .replace(/^```javascript\s*/i, '')
        .replace(/^```js\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/\s*```$/, '')
        .trim();

      // Remove redeclarations of context objects like scene/camera/renderer
      cleanedCode = stripDisallowedGlobals(cleanedCode);

      // Inject custom 3D model loading code if provided
      if (hasCustomAssets) {
        const modelLoadingCode = getModelLoadingCode(customAssets);
        cleanedCode = modelLoadingCode + '\n' + cleanedCode;
      }

      if (!cleanedCode) {
        console.warn(`[game.generate-stream][${requestId}] No code generated, using template fallback`);
        let templateCode = getTemplate(gameType, gameDescription);
        if (hasCustomAssets) {
          const modelLoadingCode = getModelLoadingCode(customAssets);
          templateCode = modelLoadingCode + '\n' + templateCode;
        }
        res.write(`data: ${JSON.stringify({ event: 'replace', text: templateCode })}\n\n`);
        res.write(`data: ${JSON.stringify({ event: 'done', done: true, source: 'template', gameType })}\n\n`);
        return res.end();
      }
      
      // Check for incomplete code (unbalanced braces) - common with streaming cutoffs
      const openBraces = (cleanedCode.match(/\{/g) || []).length;
      const closeBraces = (cleanedCode.match(/\}/g) || []).length;
      const openParens = (cleanedCode.match(/\(/g) || []).length;
      const closeParens = (cleanedCode.match(/\)/g) || []).length;
      
      if (openBraces !== closeBraces || openParens !== closeParens) {
        console.warn(`[game.generate-stream][${requestId}] Incomplete code detected! Braces: ${openBraces}/${closeBraces}, Parens: ${openParens}/${closeParens}`);
        console.warn(`[game.generate-stream][${requestId}] Using template fallback due to incomplete code`);
        let templateCode = getTemplate(gameType, gameDescription);
        if (hasCustomAssets) {
          const modelLoadingCode = getModelLoadingCode(customAssets);
          templateCode = modelLoadingCode + '\n' + templateCode;
        }
        res.write(`data: ${JSON.stringify({ event: 'replace', text: templateCode })}\n\n`);
        res.write(`data: ${JSON.stringify({ event: 'done', done: true, source: 'template-incomplete', gameType })}\n\n`);
        return res.end();
      }

      accumulatedText = cleanedCode;

      // Ensure panel holds the sanitized code (overwriting any raw streamed text)
      res.write(`data: ${JSON.stringify({ event: 'replace', text: cleanedCode })}\n\n`);

      console.log(`[game.generate-stream][${requestId}] Generated ${cleanedCode.length} chars`);
      console.log(`[game.generate-stream][${requestId}] Cache: created=${cacheCreated} read=${cacheRead}`);
      
      // STEP 2: Validate the generated code
      const fullValidation = validateGameCode(cleanedCode);
      console.log(`[game.generate-stream][${requestId}] Validation: ${fullValidation.valid ? 'PASS' : 'FAIL'}, errors: ${fullValidation.errors.length}`);
      
      let source = 'ai';
      
      // STEP 3: Only repair for CRITICAL errors, not warnings
      // Allow AI-generated code with warnings to pass through - warnings are non-blocking
      const criticalErrors = fullValidation.errors.filter(err => {
        // Only block on safety/security issues, not missing features
        return err.includes('infinite loop') || 
               err.includes('eval') || 
               err.includes('Function constructor') ||
               err.includes('document.write') ||
               err.includes('window.location');
      });
      
      // If we have critical errors OR missing required update function, try repair
      const needsRepair = !fullValidation.valid || criticalErrors.length > 0;
      
      if (needsRepair && fullValidation.errors.length > 0) {
        console.warn(`[game.generate-stream][${requestId}] Validation failed with ${fullValidation.errors.length} errors`);
        console.warn(`[game.generate-stream][${requestId}] Errors:`, fullValidation.errors.join('; '));
        console.warn(`[game.generate-stream][${requestId}] Critical errors:`, criticalErrors.join('; '));
        console.log(`[game.generate-stream][${requestId}] Attempting auto-repair...`);
        
        try {
          const internalCall = ownedApiCall(req, '/api/game/repair');
          const repairResp = await fetch(internalCall.url, {
            method: 'POST',
            ...internalCall.options,
            body: JSON.stringify({ 
              code: cleanedCode, 
              error: fullValidation.errors.join('; '), // Join errors into single string
              errors: fullValidation.errors, // Also pass array for compatibility
              description: gameDescription 
            })
          });
          
          if (repairResp.ok) {
            const repairData = await repairResp.json();
            if (repairData.code && repairData.code.length > 300) {
              console.log(`[game.generate-stream][${requestId}] Auto-repair succeeded! Sending replacement code.`);
              // Send "replace" event to update frontend with fixed code
              res.write(`data: ${JSON.stringify({ event: 'replace', text: repairData.code })}\n\n`);
              source = 'ai-repaired';
            } else {
              throw new Error('Repair returned invalid code');
            }
          } else {
            throw new Error('Repair endpoint failed');
          }
        } catch (repairError) {
          console.error(`[game.generate-stream][${requestId}] Auto-repair failed:`, repairError.message);
          
          // If only warnings and no critical errors, allow the code through anyway
          if (criticalErrors.length === 0 && fullValidation.warnings.length > 0) {
            console.log(`[game.generate-stream][${requestId}] Only warnings detected, allowing AI-generated code to pass through`);
            // Code already sent via streaming, just continue
            source = 'ai';
          } else {
            // Critical errors or missing update function - fall back to template
            console.log(`[game.generate-stream][${requestId}] Critical errors present, using template fallback`);
            let templateCode = getTemplate(gameType, gameDescription);
            // Inject custom 3D model loading code if provided
            if (hasCustomAssets) {
              const modelLoadingCode = getModelLoadingCode(customAssets);
              templateCode = modelLoadingCode + '\n' + templateCode;
            }
            // Send "replace" event with template
            res.write(`data: ${JSON.stringify({ event: 'replace', text: templateCode })}\n\n`);
            source = 'template';
          }
        }
      } else {
        // Validation passed or only warnings - code is good to use
        console.log(`[game.generate-stream][${requestId}] Validation passed (or warnings only), using AI-generated code`);
      }
      
      // STEP 4: Send completion with metadata
      res.write(`data: ${JSON.stringify({ 
        event: 'done',
        done: true, 
        model: selectedModel,
        source,
        gameType,
        metadata: geminiSpecMetadata,
        validation: fullValidation.valid,
        validationErrors: fullValidation.errors.length,
        cacheCreated,
        cacheRead
      })}\n\n`);
      
      console.log(`[game.generate-stream][${requestId}] Stream complete. Source: ${source}, Valid: ${fullValidation.valid}`);
      
    } catch (error) {
      console.error(`[game.generate-stream][${requestId}] Stream error:`, error);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    } finally {
      res.end();
    }

  } catch (error) {
    console.error('[game.generate-stream] Error:', error);
    
    // If headers not sent yet
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Stream generation failed' });
    }
    
    // Otherwise try to send error in stream
    try {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    } catch (e) {
      // Ignore if can't write
    }
    res.end();
  }
}
// Force rebuild Wed Oct 22 08:40:00 EDT 2025

export default withApiAccess(handler, "/api/game/generate-stream");
