/**
 * Upload 3D Assets to Supabase Storage
 * 
 * Run with:
 *   SUPABASE_URL=https://<your-project>.supabase.co \
 *   SUPABASE_SECRET_KEY=<server-only key> \
 *   npx tsx scripts/uploadAssetsToSupabase.ts
 *
 * Both values come from the environment only. Never commit them or keep the
 * service key in a file inside the repository.
 *
 * This script:
 * 1. Creates a public storage bucket for 3D assets
 * 2. Uploads the GLB files from public/assets/3d/, skipping every path in
 *    docs/PRIVATE_ASSET_QUARANTINE.json
 * 3. Generates updated asset paths for assetRegistry.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Supabase configuration: environment only, no defaults and no key files.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in the environment before running this script.');
  process.exit(1);
}

// Models excluded from publication (unverified source or restrictive license).
const QUARANTINED = new Set<string>(
  JSON.parse(fs.readFileSync('docs/PRIVATE_ASSET_QUARANTINE.json', 'utf8')).excluded_from_public_candidate
);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const BUCKET_NAME = '3d-assets';
const ASSETS_DIR = 'public/assets/3d';

interface UploadResult {
  localPath: string;
  remotePath: string;
  publicUrl: string;
  size: number;
  success: boolean;
  error?: string;
}

async function createBucketIfNotExists(): Promise<boolean> {
  console.log(`\n📦 Checking bucket "${BUCKET_NAME}"...`);
  
  // List existing buckets
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  
  if (listError) {
    console.error('Error listing buckets:', listError);
    return false;
  }
  
  const bucketExists = buckets?.some(b => b.name === BUCKET_NAME);
  
  if (bucketExists) {
    console.log(`✅ Bucket "${BUCKET_NAME}" already exists`);
    return true;
  }
  
  // Create new bucket with public access
  const { error: createError } = await supabase.storage.createBucket(BUCKET_NAME, {
    public: true,
    fileSizeLimit: 500 * 1024 * 1024, // 500MB limit
    allowedMimeTypes: ['model/gltf-binary', 'application/octet-stream']
  });
  
  if (createError) {
    console.error('Error creating bucket:', createError);
    return false;
  }
  
  console.log(`✅ Created public bucket "${BUCKET_NAME}"`);
  return true;
}

async function getAllGlbFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  
  function walkDir(currentPath: string) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.name.endsWith('.glb')) {
        const repoPath = fullPath.split(path.sep).join('/');
        if (QUARANTINED.has(repoPath)) {
          console.log(`   Skipping quarantined model: ${repoPath}`);
          continue;
        }
        files.push(fullPath);
      }
    }
  }
  
  walkDir(dir);
  return files;
}

async function uploadFile(localPath: string): Promise<UploadResult> {
  // Get relative path from assets dir
  const relativePath = path.relative(ASSETS_DIR, localPath);
  const remotePath = relativePath.replace(/\\/g, '/'); // Normalize for URL
  
  const stats = fs.statSync(localPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
  
  console.log(`\n📤 Uploading: ${remotePath} (${sizeMB}MB)`);
  
  try {
    const fileBuffer = fs.readFileSync(localPath);
    
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(remotePath, fileBuffer, {
        contentType: 'model/gltf-binary',
        upsert: true // Overwrite if exists
      });
    
    if (error) {
      console.error(`   ❌ Failed: ${error.message}`);
      return {
        localPath,
        remotePath,
        publicUrl: '',
        size: stats.size,
        success: false,
        error: error.message
      };
    }
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(remotePath);
    
    console.log(`   ✅ Success: ${urlData.publicUrl}`);
    
    return {
      localPath,
      remotePath,
      publicUrl: urlData.publicUrl,
      size: stats.size,
      success: true
    };
    
  } catch (err: any) {
    console.error(`   ❌ Error: ${err.message}`);
    return {
      localPath,
      remotePath,
      publicUrl: '',
      size: stats.size,
      success: false,
      error: err.message
    };
  }
}

async function generateUrlMapping(results: UploadResult[]): Promise<void> {
  const successful = results.filter(r => r.success);
  
  // Generate mapping file
  const mapping: Record<string, string> = {};
  
  for (const result of successful) {
    // Convert local path to the format used in assetRegistry
    // e.g., "/assets/3d/environment/scenes/times_square_block.glb"
    const localKey = '/' + ASSETS_DIR.replace('public/', '') + '/' + result.remotePath;
    mapping[localKey] = result.publicUrl;
  }
  
  // Write mapping file
  const mappingPath = 'scripts/supabase-asset-urls.json';
  fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));
  console.log(`\n📝 URL mapping saved to: ${mappingPath}`);
  
  // Generate code snippet for assetRegistry.ts
  console.log('\n📋 Copy this to update assetRegistry.ts:\n');
  console.log('// Supabase Storage URLs for 3D assets');
  console.log(`const SUPABASE_STORAGE_BASE = '${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}';\n`);
  console.log('// Example usage in ASSET_REGISTRY:');
  console.log('// path: `${SUPABASE_STORAGE_BASE}/environment/scenes/times_square_block.glb`');
}

async function main() {
  console.log('🚀 Supabase 3D Asset Uploader\n');
  console.log(`   Source: ${ASSETS_DIR}`);
  console.log(`   Destination: ${SUPABASE_URL}/storage/${BUCKET_NAME}`);
  
  // Create bucket
  const bucketReady = await createBucketIfNotExists();
  if (!bucketReady) {
    console.error('\n❌ Failed to create/access bucket. Exiting.');
    process.exit(1);
  }
  
  // Get all GLB files
  const files = await getAllGlbFiles(ASSETS_DIR);
  console.log(`\n📁 Found ${files.length} GLB files to upload`);
  
  // Sort by size (smallest first for faster initial results)
  files.sort((a, b) => {
    const sizeA = fs.statSync(a).size;
    const sizeB = fs.statSync(b).size;
    return sizeA - sizeB;
  });
  
  // Calculate total size
  const totalSize = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
  console.log(`   Total size: ${(totalSize / 1024 / 1024 / 1024).toFixed(2)}GB`);
  
  // Upload files
  const results: UploadResult[] = [];
  
  for (let i = 0; i < files.length; i++) {
    console.log(`\n[${i + 1}/${files.length}]`);
    const result = await uploadFile(files[i]);
    results.push(result);
  }
  
  // Summary
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 UPLOAD SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Successful: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}`);
  
  if (failed.length > 0) {
    console.log('\nFailed uploads:');
    for (const f of failed) {
      const sizeMB = (f.size / 1024 / 1024).toFixed(1);
      console.log(`   - ${f.remotePath} (${sizeMB}MB): ${f.error}`);
    }
  }
  
  // Generate URL mapping
  await generateUrlMapping(results);
  
  console.log('\n✨ Done!');
}

main().catch(console.error);
