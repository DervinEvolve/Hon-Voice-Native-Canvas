import { withApiAccess } from "../_lib/api-access.js";
/**
 * API Route: Process Gaussian Splat into LOD Streaming Format
 * 
 * This processes uploaded .ply/.splat files into PlayCanvas LOD streaming format
 * using splat-transform CLI.
 * 
 * Flow:
 * 1. Download source file from Supabase
 * 2. Generate decimated LOD levels using opacity filtering
 * 3. Combine into lod-meta.json format
 * 4. Upload results to Supabase
 * 5. Return LOD URL
 */

import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { authorizeSplatRequest, validSceneId, allowedLodSource, boundedDownload, MAX_SPLAT_BYTES } from '../_lib/splat-security.js';
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRequire } from 'module';

// Get the path to splat-transform CLI
const require = createRequire(import.meta.url);
let splatTransformPath;
try {
  splatTransformPath = require.resolve('@playcanvas/splat-transform/bin/cli.mjs');
} catch (e) {
  console.error('[process-lod] Could not resolve splat-transform path:', e);
}

// Configure for longer timeout (Vercel Pro)
export const config = {
  maxDuration: 300, // 5 minutes
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: false,
  },
};

 async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();

  try {
    const context = await authorizeSplatRequest(req, res, createClient);
    if (!context) return;
    const { client: supabase, userId, storageOrigin } = context;
    // LOD metadata references multiple public files. Require deliberate publication
    // until private multi-file delivery is implemented; SHARP output stays private.
    if (process.env.HON_ALLOW_PUBLIC_LOD_OUTPUT !== 'true') {
      return res.status(503).json({ error: 'Public LOD output is not enabled' });
    }
    const { fileUrl, sceneId } = req.body || {};

    if (typeof fileUrl !== 'string' || !validSceneId(sceneId)) {
      return res.status(400).json({ error: 'fileUrl and sceneId are required' });
    }

    let source;
    try { source = allowedLodSource(fileUrl, storageOrigin); }
    catch {
      return res.status(400).json({ error: 'Source must be a public asset in this project storage' });
    }

    // Create temp directory for processing
    const workDir = mkdtempSync(join(tmpdir(), 'hon-lod-'));
    
    const outputDir = join(workDir, 'output');
    mkdirSync(outputDir, { recursive: true });

    try {
      // Step 1: Download source file
      console.log('[process-lod] Downloading source file...');
      const fileBuffer = await boundedDownload(source.href, MAX_SPLAT_BYTES);
      const inputPath = join(workDir, 'input.ply');
      writeFileSync(inputPath, fileBuffer);
      console.log('[process-lod] Downloaded:', (fileBuffer.length / 1024 / 1024).toFixed(2), 'MB');

      // Step 2: Generate LOD levels using opacity filtering
      // Higher opacity = more important splats = keep in lower LOD levels
      const lodLevels = [
        { level: 0, filter: 'opacity,gt,0.7' },  // Highest detail - keep splats with opacity > 0.7
        { level: 1, filter: 'opacity,gt,0.4' },  // Medium-high
        { level: 2, filter: 'opacity,gt,0.2' },  // Medium
        { level: 3, filter: 'opacity,gt,0.05' }, // Low detail - almost all splats
      ];

      const lodFiles = [];
      
      // Check if splat-transform is available
      if (!splatTransformPath) {
        throw new Error('splat-transform CLI not found in node_modules');
      }
      console.log('[process-lod] Using splat-transform at:', splatTransformPath);
      
      for (const lod of lodLevels) {
        const lodPath = join(workDir, `lod${lod.level}.ply`);
        console.log(`[process-lod] Generating LOD ${lod.level} with filter ${lod.filter}...`);
        
        try {
          // Use splat-transform to filter by opacity
          const args = [splatTransformPath, inputPath, '-V', lod.filter, '--filter-nan', lodPath, '-w'];
          const result = execFileSync(process.execPath, args, { 
            cwd: process.cwd(),
            timeout: 60000, // 60 second timeout per LOD level
            stdio: 'pipe',
            encoding: 'utf-8'
          });
          
          console.log(`[process-lod] LOD ${lod.level} output:`, result);
          
          if (existsSync(lodPath)) {
            lodFiles.push(lodPath);
            console.log(`[process-lod] LOD ${lod.level} generated successfully`);
          } else {
            console.warn(`[process-lod] LOD ${lod.level} file not created at ${lodPath}`);
          }
        } catch (lodErr) {
          console.error(`[process-lod] Failed to generate LOD ${lod.level}:`, {
            message: lodErr.message,
            stderr: lodErr.stderr?.toString(),
            stdout: lodErr.stdout?.toString()
          });
          // Continue with other LOD levels
        }
      }

      if (lodFiles.length === 0) {
        throw new Error('Failed to generate any LOD levels');
      }

      // Step 3: Combine into lod-meta.json format
      console.log('[process-lod] Combining LOD levels into streaming format...');
      
      // Build the splat-transform command for LOD generation
      const combineArgs = [splatTransformPath];
      lodFiles.forEach((lodPath, index) => combineArgs.push(lodPath, '-l', String(index)));
      combineArgs.push(join(outputDir, 'lod-meta.json'), '--filter-nan', '-w');
      const combineResult = execFileSync(process.execPath, combineArgs, {
        cwd: process.cwd(),
        timeout: 120000, // 2 minute timeout
        stdio: 'pipe',
        encoding: 'utf-8'
      });
      
      console.log('[process-lod] Combine output:', combineResult);

      // Step 4: Upload results to Supabase
      console.log('[process-lod] Uploading LOD files to Supabase...');
      
      const outputFiles = readdirSync(outputDir);
      const uploadedUrls = {};
      
      for (const file of outputFiles) {
        const filePath = join(outputDir, file);
        const fileContent = readFileSync(filePath);
        const storagePath = `worlds/lod/${userId}/${sceneId}/${file}`;
        
        const { error: uploadError } = await supabase.storage
          .from('hon-assets')
          .upload(storagePath, fileContent, {
            cacheControl: '31536000',
            upsert: true,
            contentType: file.endsWith('.json') ? 'application/json' : 
                        file.endsWith('.webp') ? 'image/webp' : 'application/octet-stream'
          });

        if (uploadError) {
          console.error(`[process-lod] Failed to upload ${file}:`, uploadError);
        } else {
          const { data: urlData } = supabase.storage
            .from('hon-assets')
            .getPublicUrl(storagePath);
          uploadedUrls[file] = urlData.publicUrl;
          console.log(`[process-lod] Uploaded: ${file}`);
        }
      }

      const lodMetaUrl = uploadedUrls['lod-meta.json'];
      
      if (!lodMetaUrl) {
        throw new Error('Failed to upload lod-meta.json');
      }

      // Step 5: Return success
      const processingTime = (Date.now() - startTime) / 1000;
      console.log(`[process-lod] Complete in ${processingTime.toFixed(1)}s. LOD URL:`, lodMetaUrl);

      return res.status(200).json({
        success: true,
        message: 'LOD streaming format generated successfully',
        lodUrl: lodMetaUrl,
        processingTime,
      });

    } finally {
      // Cleanup temp directory
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.warn('[process-lod] Cleanup error:', cleanupErr);
      }
    }

  } catch (error) {
    console.error('[process-lod] Error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to process LOD',
      details: 'See private server diagnostics'
    });
  }
}

export default withApiAccess(handler, "/api/splat/process-lod");
