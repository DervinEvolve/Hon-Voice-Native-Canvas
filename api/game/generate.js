import { withApiAccess } from "../_lib/api-access.js";
import { ownedApiCall } from '../_lib/api-access.js';
import Replicate from 'replicate';
import { nanoid } from 'nanoid';
// Import the new enhanced game generation helpers
import { detectGameType, getTemplate, getModelLoadingCode } from '../../src/lib/gameTemplates.js';
import { validateGameCode, sanitizeGameCode, autoFixGame } from '../../src/lib/validateGame.js';
import { generateEnhancedPrompt, ENHANCED_SYSTEM_PROMPT } from '../../src/lib/gamePrompts.js';
import { requestStructuredGeminiGame } from '../../src/lib/gemini3StructuredRequest.js';

 async function handler(req, res) {
  // Basic CORS for local tools and clients
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { description, options = {}, model, provider = 'replicate', customAssets = {} } = req.body || {};
    const requestId = (req.headers['x-request-id'] ? String(req.headers['x-request-id']) : '') || `game_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (!description || typeof description !== 'string') {
      console.warn(`[game.generate][${requestId}] Missing description`);
      return res.status(400).json({ error: 'Description required', requestId });
    }
    
    // Check if custom 3D assets are provided (from Meshy, etc.)
    const hasCustomAssets = customAssets && typeof customAssets === 'object' && Object.keys(customAssets).length > 0;
    if (hasCustomAssets) {
      console.log(`[game.generate][${requestId}] Custom 3D assets provided:`, Object.keys(customAssets));
    }

    console.log(`[game.generate][${requestId}] Start: provider=${provider} model=${model || options?.model || '(default)'} desc.len=${description.length}`);

    // Detect game type early to optimize prompt
    const gameType = detectGameType(description);
    console.log(`[game.generate][${requestId}] Detected game type: ${gameType}`);

    let providerName = (provider || '').toLowerCase();
    const modelName = (model || options?.model || '').toLowerCase();

    async function generateWithClaude() {
      console.log(`[game.generate.claude][${requestId}] Generating ${gameType} game...`);
      
      let apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        const parts = [
          process.env.CLAUDE_API_KEY_PART1,
          process.env.CLAUDE_API_KEY_PART2,
          process.env.CLAUDE_API_KEY_PART3
        ].filter(Boolean);
        
        if (parts.length === 3) {
          apiKey = parts.join('');
          console.log(`[game.generate.claude][${requestId}] Using split API key`);
        }
      }
      
      if (!apiKey) {
        console.error(`[game.generate.claude][${requestId}] Missing CLAUDE_API_KEY`);
        return null;
      }

      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          console.log(`[game.generate.claude][${requestId}] Attempt ${attempt}/${maxAttempts}`);
          
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-beta': 'prompt-caching-2024-07-31'
            },
            body: JSON.stringify({
              model: model || options.model || 'claude-sonnet-4-5-20250929',
              max_tokens: options.max_tokens ?? 4000,
              temperature: options.temperature ?? 0.4,
              system: [
                {
                  type: "text",
                  text: ENHANCED_SYSTEM_PROMPT,
                  cache_control: { type: "ephemeral" }
                }
              ],
              messages: [
                { 
                  role: 'user', 
                  content: generateEnhancedPrompt(description, customAssets) 
                }
              ]
            })
          });

          const data = await response.json();

          if (!response.ok) {
            console.error(`[game.generate.claude][${requestId}] API error:`, data.error || data);
            if (attempt === maxAttempts) {
              return null;
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }

          const generatedCode = data.content?.[0]?.text || '';
          console.log(`[game.generate.claude][${requestId}] Generated ${generatedCode.length} chars`);
          
          // Log cache performance
          const cacheCreated = data.usage?.cache_creation_input_tokens || 0;
          const cacheRead = data.usage?.cache_read_input_tokens || 0;
          console.log(`[game.generate.claude][${requestId}] Cache: created=${cacheCreated} read=${cacheRead}`);
          
          return generatedCode;
        } catch (error) {
          console.error(`[game.generate.claude][${requestId}] Attempt ${attempt} failed:`, error.message);
          if (attempt === maxAttempts) {
            return null;
          }
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
      
      return null;
    }

    // Main generation flow
    let finalCode = null;
    let source = 'ai';

    // Step 1: Try AI generation
    let geminiSucceeded = false;
    if (providerName === 'gemini' || providerName === 'gemini3' || !providerName) {
      // Use Gemini 3 Pro for game generation
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        console.error(`[game.generate][${requestId}] Missing GEMINI_API_KEY, falling back to Claude`);
        providerName = 'claude';
      } else {
        try {
          console.log(`[game.generate][${requestId}] Using Gemini 3 Pro structured pipeline`);
          const { code: structuredCode, spec } = await requestStructuredGeminiGame({
            description,
            customAssets,
            temperature: options.temperature ?? 0.75,
            maxTokens: options.max_tokens ?? 4096,
            requestId
          });

          console.log(`[game.generate][${requestId}] Gemini 3 structured spec generated ${structuredCode.length} chars`);
          
          let generatedCode = structuredCode;
          if (hasCustomAssets) {
            const modelLoadingCode = getModelLoadingCode(customAssets);
            generatedCode = modelLoadingCode + '\n' + generatedCode;
          }
          
          const validation = validateGameCode(generatedCode);
          if (validation.valid) {
            const safeCode = sanitizeGameCode(generatedCode);
            return res.status(200).json({
              success: true,
              gameCode: safeCode,
              source: 'gemini3',
              requestId,
              metadata: spec?.metadata || null
            });
          } else {
            console.warn(`[game.generate][${requestId}] Gemini 3 validation failed, trying repair...`);
            const fixed = autoFixGame(generatedCode, validation.errors);
            if (fixed) {
              return res.status(200).json({
                success: true,
                gameCode: sanitizeGameCode(fixed),
                source: 'gemini3-repaired',
                requestId,
                metadata: spec?.metadata || null
              });
            }
          }
          
          console.log(`[game.generate][${requestId}] Gemini 3 validation/repair failed, falling back to Claude...`);
          providerName = 'claude';
        } catch (error) {
          console.error(`[game.generate][${requestId}] Gemini 3 generation failed:`, error.message || error);
          console.log(`[game.generate][${requestId}] Falling back to Claude...`);
          // Fall through to Claude generation below
          providerName = 'claude';
        }
      }
    }
    
    // Claude generation (either requested or fallback from Gemini)
    if (!geminiSucceeded && (providerName === 'claude' || providerName === 'anthropic' || !providerName)) {
      const claudeKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
      if (!claudeKey) {
        console.error(`[game.generate][${requestId}] Missing CLAUDE_API_KEY`);
        return res.status(500).json({ error: 'Server configuration error: Claude key missing', requestId });
      }
      const systemPrompt = ENHANCED_SYSTEM_PROMPT;
      const payload = {
        model: model || options.model || 'claude-sonnet-4-5-20250929',
        max_tokens: options.max_tokens ?? 4000,
        temperature: options.temperature ?? 0.4,
        // CACHED SYSTEM PROMPT - 90% cost reduction
        system: [
          {
            type: "text",
            text: systemPrompt,
            cache_control: { type: "ephemeral" }
          }
        ],
        messages: [
          { role: 'user', content: generateEnhancedPrompt(description, customAssets) }
        ]
      };
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31'
        },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (resp.ok && data.content?.[0]?.text) {
        const generatedCode = data.content[0].text.trim()
          .replace(/^```javascript\s*/i, '')
          .replace(/^```js\s*/i, '')
          .replace(/^```\s*/, '')
          .replace(/\s*```$/, '');
        
        console.log(`[game.generate][${requestId}] Claude generated ${generatedCode.length} chars`);
        
        // Log cache performance
        const cacheCreated = data.usage?.cache_creation_input_tokens || 0;
        const cacheRead = data.usage?.cache_read_input_tokens || 0;
        console.log(`[game.generate][${requestId}] Cache: created=${cacheCreated} read=${cacheRead}`);
        
        // Quick validation
        const quickCheck = quickValidate(generatedCode);
        console.log(`[game.generate][${requestId}] Quick validation: ${quickCheck.valid ? 'PASS' : 'FAIL'}`);
        
        if (quickCheck.valid) {
          finalCode = generatedCode;
        } else {
          console.warn(`[game.generate][${requestId}] Quick validation failed, will try repair`);
          
          // Try to repair
          const internalCall = ownedApiCall(req, '/api/game/repair');
          const repairResp = await fetch(internalCall.url, {
            method: 'POST',
            ...internalCall.options,
            body: JSON.stringify({ 
              code: generatedCode, 
              errors: quickCheck.errors,
              description 
            })
          });
          
          if (repairResp.ok) {
            const repairData = await repairResp.json();
            if (repairData.code) {
              console.log(`[game.generate][${requestId}] Repair succeeded`);
              finalCode = repairData.code;
            }
          }
        }
      } else {
        console.error(`[game.generate][${requestId}] Claude API error:`, data.error || data);
      }
    } else if (providerName === 'xai' || providerName === 'grok') {
      const xaiKey = process.env.XAI_API_KEY || process.env.XAI_KEY || process.env.GROK_API_KEY;
      if (!xaiKey) {
        console.error('Missing XAI_API_KEY');
        return res.status(500).json({ error: 'Server configuration error: XAI key missing' });
      }
      const systemPrompt = [
        'You write working Three.js mini-games as plain JavaScript (no TypeScript).',
        'The host provides camera, ambient/directional lights, a ground plane, and a fixed-step game loop.',
        'You MUST only set up content and optionally assign scene.userData.update = (ctx) => { /* logic */ }.',
        'ctx contains: { time, dt, input, rng, THREE, scene, camera }. Do not access window/document.',
        'Return ONLY the function body for (THREE, scene, camera, controls). No markdown, no comments, no imports/exports.',
        'Example: let box = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({color: 0xff0000})); scene.add(box);',
        'If you need animation: scene.userData.update = ({time, dt}) => { box.rotation.y += dt; };'
      ].join(' ');
      const payload = {
        model: model || options.model || 'grok-code-fast-1',
        temperature: options.temperature ?? 0.4,
        max_tokens: options.max_tokens ?? 4000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Build a single-player, panel-embedded Three.js mini-game per spec. Do not mention co-op or multiple players. Description: ${description}` }
        ]
      };
      const resp = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${xaiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (resp.ok && data.choices?.[0]?.message?.content) {
        const generatedCode = data.choices[0].message.content.trim()
          .replace(/^```javascript\s*/i, '')
          .replace(/^```js\s*/i, '')
          .replace(/^```\s*/, '')
          .replace(/\s*```$/, '');
        console.log(`[game.generate][${requestId}] XAI generated ${generatedCode.length} chars`);
        finalCode = generatedCode;
      } else {
        console.error(`[game.generate][${requestId}] XAI API error:`, data.error || data);
      }
    } else {
      // Replicate models
      const replicateKey = process.env.REPLICATE_API_TOKEN;
      if (!replicateKey) {
        console.error('Missing REPLICATE_API_TOKEN');
        return res.status(500).json({ error: 'Server configuration error' });
      }
      const systemInstr = 'You create Three.js games. Output ONLY JavaScript code. The game loop is scene.userData.update = function(ctx) { }. ctx has: time, dt, input, THREE, scene, camera. No TypeScript, no markdown.';
      const replicateModel = model || options.model || 'replicate/llama-2-70b:latest';
      const promptStr = `${systemInstr}\n\nUser description:\n${description}\n\nReturn only raw JavaScript code.`;

      // Use blocking run with required prompt field
      const output = await replicate.run(replicateModel, {
        input: {
          prompt: promptStr,
          max_tokens: options.max_tokens ?? 4000,
          temperature: options.temperature ?? 0.4
        }
      });
      const generatedText = Array.isArray(output) ? output.join('') : String(output || '');
      const generatedCode = generatedText.trim()
        .replace(/^```javascript\s*/i, '')
        .replace(/^```js\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/\s*```$/, '');
      console.log(`[game.generate][${requestId}] Replicate generated ${generatedCode.length} chars`);
      finalCode = generatedCode;
    }

    // Step 2: If AI failed or produced invalid code, use template
    if (!finalCode) {
      console.log(`[game.generate][${requestId}] AI generation failed, using ${gameType} template`);
      finalCode = getTemplate(gameType, description);
      // Inject custom 3D model loading code if provided
      if (hasCustomAssets) {
        const modelLoadingCode = getModelLoadingCode(customAssets);
        finalCode = modelLoadingCode + '\n' + finalCode;
      }
      source = 'template';
    } else if (hasCustomAssets) {
      // Inject custom 3D model loading code into AI-generated code
      const modelLoadingCode = getModelLoadingCode(customAssets);
      finalCode = modelLoadingCode + '\n' + finalCode;
    }

    // Step 3: Auto-fix common issues
    if (source !== 'template') {
      finalCode = autoFixGame(finalCode);
    }
    
    // Step 4: Sanitize for safety
    finalCode = sanitizeGameCode(finalCode);
    
    // Step 5: Final validation
    const validation = validateGameCode(finalCode);
    console.log(`[game.generate][${requestId}] Final validation: score=${validation.score}/100, errors=${validation.errors.length}, warnings=${validation.warnings.length}`);

    // Emergency fallback
    if (!validation.isValid && source !== 'template') {
      console.warn(`[game.generate][${requestId}] Generated code invalid (${validation.errors.join(', ')}), falling back to template`);
      finalCode = getTemplate(gameType, description);
      source = 'template';
    }

    const response = {
      success: true,
      requestId,
      code: finalCode,
      metadata: {
        provider,
        model: model || options?.model || 'default',
        gameType,
        source,
        description: description.slice(0, 100),
        codeLength: finalCode.length,
        validationPassed: validation.isValid,
        validationScore: validation.score,
        validationErrors: validation.errors,
        validationWarnings: validation.warnings
      }
    };

    console.log(`[game.generate][${requestId}] Success: type=${gameType} source=${source} len=${finalCode.length}`);
    return res.status(200).json(response);

  } catch (error) {
    const requestId = req.headers['x-request-id'] || 'unknown';
    console.error(`[game.generate][${requestId}] Fatal error:`, error);
    
    // Last resort: return a simple template
    try {
      const gameType = detectGameType(req.body?.description || '');
      let fallbackCode = getTemplate(gameType, req.body?.description || 'simple game');
      // Inject custom 3D model loading code if provided
      const customAssets = req.body?.customAssets || {};
      if (customAssets && typeof customAssets === 'object' && Object.keys(customAssets).length > 0) {
        const modelLoadingCode = getModelLoadingCode(customAssets);
        fallbackCode = modelLoadingCode + '\n' + fallbackCode;
      }
      
      return res.status(200).json({
        success: true,
        requestId,
        code: fallbackCode,
        metadata: {
          provider: 'template',
          model: 'fallback',
          gameType,
          source: 'emergency-fallback',
          error: error.message
        }
      });
    } catch (fallbackError) {
      return res.status(500).json({ 
        error: 'Game generation failed', 
        requestId,
        details: error.message 
      });
    }
  }
}
// Force rebuild Wed Oct 22 08:40:09 EDT 2025

export default withApiAccess(handler, "/api/game/generate");
