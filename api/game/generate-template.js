import { withApiAccess } from "../_lib/api-access.js";
// Template-based game generation endpoint
// Uses pre-validated templates from gameTemplates.js

import { detectGameType, getTemplate, getModelLoadingCode } from '../../src/lib/gameTemplates.js';

 async function handler(req, res) {
  // CORS
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
    const { description, prompt, customAssets = {} } = req.body;
    const gameDescription = description || prompt || '';
    
    if (!gameDescription) {
      return res.status(400).json({ error: 'Description required' });
    }

    // Check if custom 3D assets are provided
    const hasCustomAssets = customAssets && typeof customAssets === 'object' && Object.keys(customAssets).length > 0;
    if (hasCustomAssets) {
      console.log(`[game.generate-template] Custom 3D assets provided:`, Object.keys(customAssets));
    }

    console.log(`[game.generate-template] Generating template for: "${gameDescription}"`);

    // Detect game type and get the validated template
    const gameType = detectGameType(gameDescription);
    let templateCode = getTemplate(gameType, gameDescription);
    
    // Inject custom 3D model loading code if provided
    if (hasCustomAssets) {
      const modelLoadingCode = getModelLoadingCode(customAssets);
      templateCode = modelLoadingCode + '\n' + templateCode;
    }

    console.log(`[game.generate-template] Using ${gameType} template (${templateCode.length} chars)`);
    
    // Log first 500 chars to verify correct format
    console.log(`[game.generate-template] Template preview: ${templateCode.substring(0, 500)}`);

    // Check if template has correct material format
    const hasCorrectMaterials = templateCode.includes('emissive: 0x');
    console.log(`[game.generate-template] Has correct material format: ${hasCorrectMaterials}`);

    return res.status(200).json({ 
      gameCode: templateCode,
      code: templateCode,  // Also include 'code' for compatibility
      gameType,
      source: 'template',
      description: gameDescription
    });

  } catch (error) {
    console.error('[game.generate-template] Error:', error);
      return res.status(500).json({ 
      error: 'Template generation failed', 
      details: error.message 
      });
  }
}
// Force rebuild Wed Oct 22 08:40:09 EDT 2025

export default withApiAccess(handler, "/api/game/generate-template");
