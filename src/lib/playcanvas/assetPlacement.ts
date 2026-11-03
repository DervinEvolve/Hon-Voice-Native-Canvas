/**
 * Intelligent Asset Placement System
 *
 * Handles proper positioning, scaling, and validation of GLB assets in the scene.
 * Ensures assets are placed ON the ground (not in it) and at correct real-world scale.
 */

import type { Asset3D, RealWorldDimensions } from './assetRegistry';
import {
  isEnvironmentAsset as checkIsEnvironmentAsset,
  detectSceneAutoScale,
  getSceneSizeRange,
  getRotationCorrection
} from './assetRegistry';

/**
 * Bounding box information for a loaded entity
 */
export interface EntityBoundingBox {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  center: { x: number; y: number; z: number };
}

/**
 * Result of asset placement validation
 */
export interface PlacementValidation {
  isValid: boolean;
  actualDimensions: { width: number; height: number; depth: number };
  expectedDimensions: RealWorldDimensions;
  scaleRatio: number;
  warnings: string[];
  suggestions: string[];
}

/**
 * Placement options for an asset
 */
export interface PlacementOptions {
  /** Target position (x, z will be used, y will be calculated for ground placement) */
  position: { x: number; y: number; z: number };
  /** Rotation in degrees */
  rotation?: { x: number; y: number; z: number };
  /** Override scale (if not provided, uses normalizedScale from asset) */
  scale?: number;
  /** Whether to automatically place on ground (default: true for non-scene assets) */
  placeOnGround?: boolean;
  /** Ground level Y coordinate (default: 0) */
  groundLevel?: number;
  /** Whether this is a scene/environment asset that defines the ground */
  isEnvironmentAsset?: boolean;
}

/**
 * Result of asset placement
 */
export interface PlacementResult {
  entity: any; // pc.Entity
  finalPosition: { x: number; y: number; z: number };
  finalScale: number;
  boundingBox: EntityBoundingBox;
  validation: PlacementValidation;
}

/**
 * Calculate the bounding box of an entity after scaling
 * @param entity - PlayCanvas entity with render component
 * @param pc - PlayCanvas namespace
 * @returns EntityBoundingBox with isDefault flag if fallback was used
 */
export function calculateEntityBoundingBox(entity: any, pc: any): EntityBoundingBox & { isDefault?: boolean } {
  const meshInstances = entity.render?.meshInstances || [];

  if (meshInstances.length === 0) {
    // Try to find mesh instances in children
    const allMeshInstances: any[] = [];
    entity.findComponents('render').forEach((render: any) => {
      if (render.meshInstances) {
        allMeshInstances.push(...render.meshInstances);
      }
    });

    if (allMeshInstances.length === 0) {
      // No mesh instances found, return default small box with flag
      console.warn('[AssetPlacement] No mesh instances found - using default bounding box');
      return {
        min: { x: -0.5, y: 0, z: -0.5 },
        max: { x: 0.5, y: 1, z: 0.5 },
        size: { x: 1, y: 1, z: 1 },
        center: { x: 0, y: 0.5, z: 0 },
        isDefault: true
      };
    }
    meshInstances.push(...allMeshInstances);
  }

  // Calculate combined AABB from all mesh instances
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  meshInstances.forEach((mi: any) => {
    // Check if aabb exists AND has valid minimum/maximum properties
    if (mi.aabb && mi.aabb.minimum && mi.aabb.maximum) {
      const aabb = mi.aabb;
      minX = Math.min(minX, aabb.minimum.x);
      minY = Math.min(minY, aabb.minimum.y);
      minZ = Math.min(minZ, aabb.minimum.z);
      maxX = Math.max(maxX, aabb.maximum.x);
      maxY = Math.max(maxY, aabb.maximum.y);
      maxZ = Math.max(maxZ, aabb.maximum.z);
    }
  });

  // Handle case where no valid AABBs were found
  if (!isFinite(minX)) {
    console.warn('[AssetPlacement] No valid AABBs found in mesh instances - using default bounding box');
    return {
      min: { x: -0.5, y: 0, z: -0.5 },
      max: { x: 0.5, y: 1, z: 0.5 },
      size: { x: 1, y: 1, z: 1 },
      center: { x: 0, y: 0.5, z: 0 },
      isDefault: true
    };
  }

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    size: {
      x: maxX - minX,
      y: maxY - minY,
      z: maxZ - minZ
    },
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2
    }
  };
}

/**
 * Validate the placement and dimensions of an asset
 * Uses scene size categories for smarter validation of environment assets
 */
export function validatePlacement(
  boundingBox: EntityBoundingBox,
  assetDef: Asset3D,
  expectedDimensions: RealWorldDimensions,
  finalScale: number
): PlacementValidation {
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // Calculate actual dimensions after scaling
  const actualDimensions = {
    width: boundingBox.size.x,
    height: boundingBox.size.y,
    depth: boundingBox.size.z
  };

  // Calculate how far off we are from expected dimensions
  const heightRatio = actualDimensions.height / expectedDimensions.height;
  const widthRatio = actualDimensions.width / expectedDimensions.width;
  const depthRatio = actualDimensions.depth / expectedDimensions.depth;
  const avgRatio = (heightRatio + widthRatio + depthRatio) / 3;

  // For scene/terrain assets, use scene size range validation
  const sizeRange = getSceneSizeRange(assetDef);
  if (sizeRange) {
    const footprint = Math.max(actualDimensions.width, actualDimensions.depth);
    if (footprint < sizeRange.min * 0.5) {
      warnings.push(`Scene footprint ${footprint.toFixed(0)}m is smaller than expected for ${assetDef.sceneSize} scene (min: ${sizeRange.min}m)`);
      const suggestedScale = (sizeRange.target / footprint) * finalScale;
      suggestions.push(`Try scale: ${suggestedScale.toFixed(4)} to achieve ~${sizeRange.target}m footprint`);
    } else if (footprint > sizeRange.max * 2) {
      warnings.push(`Scene footprint ${footprint.toFixed(0)}m is larger than expected for ${assetDef.sceneSize} scene (max: ${sizeRange.max}m)`);
      const suggestedScale = (sizeRange.target / footprint) * finalScale;
      suggestions.push(`Try scale: ${suggestedScale.toFixed(4)} to achieve ~${sizeRange.target}m footprint`);
    }
  } else {
    // Non-scene asset - use standard ratio validation
    // Check if dimensions are way off (more than 5x or less than 0.2x)
    if (avgRatio > 5) {
      warnings.push(`Asset "${assetDef.name}" appears ${avgRatio.toFixed(1)}x LARGER than expected`);
      suggestions.push(`Try scale: ${(finalScale / avgRatio).toFixed(4)} instead of ${finalScale}`);
    } else if (avgRatio < 0.2) {
      warnings.push(`Asset "${assetDef.name}" appears ${(1/avgRatio).toFixed(1)}x SMALLER than expected`);
      suggestions.push(`Try scale: ${(finalScale / avgRatio).toFixed(4)} instead of ${finalScale}`);
    }
  }

  // Check for unrealistic absolute dimensions on vehicles
  if (assetDef.category === 'vehicle') {
    if (actualDimensions.height > 10) {
      warnings.push(`Vehicle height ${actualDimensions.height.toFixed(1)}m seems too tall (expected ~1.5-3m)`);
    }
    if (actualDimensions.depth > 20) {
      warnings.push(`Vehicle length ${actualDimensions.depth.toFixed(1)}m seems too long (expected ~4-7m)`);
    }
  }

  // Check for unrealistic character dimensions
  if (assetDef.category === 'character') {
    if (actualDimensions.height > 5) {
      warnings.push(`Character height ${actualDimensions.height.toFixed(1)}m seems too tall (expected ~1.5-2m)`);
    }
    if (actualDimensions.height < 0.5) {
      warnings.push(`Character height ${actualDimensions.height.toFixed(1)}m seems too small (expected ~1.5-2m)`);
    }
  }

  return {
    isValid: warnings.length === 0,
    actualDimensions,
    expectedDimensions,
    scaleRatio: avgRatio,
    warnings,
    suggestions
  };
}

/**
 * Calculate the correct Y position to place an entity on the ground
 * Takes into account the entity's bounding box minimum Y
 */
export function calculateGroundPlacementY(
  boundingBox: EntityBoundingBox,
  groundLevel: number = 0
): number {
  // The entity's pivot might not be at the bottom
  // We need to offset so the bottom of the bounding box touches the ground
  const offsetFromPivot = -boundingBox.min.y;
  return groundLevel + offsetFromPivot;
}

/**
 * Auto-detect and correct orientation issues for scene/terrain assets.
 *
 * Many 3D assets from sources like Sketchfab are exported with Z-up orientation
 * (common in Blender) but PlayCanvas uses Y-up. This results in assets appearing
 * "standing vertically" instead of lying flat.
 *
 * Detection logic:
 * - For scene/terrain assets, the footprint (X, Z) should be larger than height (Y)
 * - If Y > 1.5 * max(X, Z), the asset is likely rotated wrong
 * - Apply -90 X rotation to convert Z-up to Y-up
 *
 * @param entity - The loaded PlayCanvas entity
 * @param pc - PlayCanvas namespace
 * @param assetDef - Asset definition
 * @returns Object with correction applied and rotation values
 */
export function detectAndCorrectOrientation(
  entity: any,
  pc: any,
  assetDef: Asset3D
): {
  correctionApplied: boolean;
  rotation: { x: number; y: number; z: number };
  originalBoundingBox: EntityBoundingBox;
  correctedBoundingBox: EntityBoundingBox | null;
} {
  // AUTO-DETECTION DISABLED - using manual rotationCorrection per-asset instead
  // The bounding box ratio approach doesn't work reliably for all asset types
  // TODO: Revisit with a better detection algorithm
  const shouldAutoDetect = false; // Was: assetDef.subcategory === 'scene' || assetDef.subcategory === 'terrain';

  if (!shouldAutoDetect) {
    return {
      correctionApplied: false,
      rotation: { x: 0, y: 0, z: 0 },
      originalBoundingBox: calculateEntityBoundingBox(entity, pc),
      correctedBoundingBox: null
    };
  }

  // Get the raw bounding box before any rotation
  entity.setEulerAngles(0, 0, 0);
  const originalBB = calculateEntityBoundingBox(entity, pc);

  // Skip if we got a default/fallback bounding box
  if ((originalBB as any).isDefault) {
    console.warn('[AssetPlacement] Cannot auto-detect orientation - bounding box detection failed');
    return {
      correctionApplied: false,
      rotation: { x: 0, y: 0, z: 0 },
      originalBoundingBox: originalBB,
      correctedBoundingBox: null
    };
  }

  const { x: width, y: height, z: depth } = originalBB.size;
  const footprint = Math.max(width, depth);

  // Detection threshold: if height is significantly larger than footprint,
  // the asset is likely standing up instead of lying flat
  const heightToFootprintRatio = height / footprint;
  const needsCorrection = heightToFootprintRatio > 1.5;

  console.log(`[AssetPlacement] Orientation check for "${assetDef.name}":`, {
    rawDimensions: `W:${width.toFixed(1)} H:${height.toFixed(1)} D:${depth.toFixed(1)}`,
    footprint: footprint.toFixed(1),
    heightToFootprintRatio: heightToFootprintRatio.toFixed(2),
    needsCorrection
  });

  if (needsCorrection) {
    // Apply -90 X rotation to convert Z-up to Y-up
    entity.setEulerAngles(-90, 0, 0);
    const correctedBB = calculateEntityBoundingBox(entity, pc);

    console.log(`[AssetPlacement] Auto-corrected orientation for "${assetDef.name}":`, {
      originalDimensions: `W:${width.toFixed(1)} H:${height.toFixed(1)} D:${depth.toFixed(1)}`,
      correctedDimensions: `W:${correctedBB.size.x.toFixed(1)} H:${correctedBB.size.y.toFixed(1)} D:${correctedBB.size.z.toFixed(1)}`,
      appliedRotation: '-90 X (Z-up to Y-up conversion)'
    });

    // Reset rotation - it will be applied properly in the main placement flow
    entity.setEulerAngles(0, 0, 0);

    return {
      correctionApplied: true,
      rotation: { x: -90, y: 0, z: 0 },
      originalBoundingBox: originalBB,
      correctedBoundingBox: correctedBB
    };
  }

  return {
    correctionApplied: false,
    rotation: { x: 0, y: 0, z: 0 },
    originalBoundingBox: originalBB,
    correctedBoundingBox: null
  };
}

/**
 * Determine appropriate default rotation for asset type
 */
export function getDefaultRotation(assetDef: Asset3D): { x: number; y: number; z: number } {
  // Vehicles should face forward (along Z axis typically)
  if (assetDef.category === 'vehicle') {
    return { x: 0, y: 0, z: 0 };
  }

  // Characters face forward
  if (assetDef.category === 'character') {
    return { x: 0, y: 0, z: 0 };
  }

  // Default no rotation
  return { x: 0, y: 0, z: 0 };
}

/**
 * Smart asset placement - handles scaling, positioning, and validation
 *
 * For scene/terrain assets: Uses auto-scale detection based on raw bounding box
 * For other assets: Uses normalizedScale from asset definition
 */
export async function placeAssetIntelligently(
  app: any, // PlayCanvas Application
  pc: any,  // PlayCanvas namespace
  entity: any, // The loaded entity
  assetDef: Asset3D,
  options: PlacementOptions,
  getNormalizedScale: (asset: Asset3D) => number,
  getAssetDimensions: (asset: Asset3D) => RealWorldDimensions
): Promise<PlacementResult> {
  const {
    position,
    rotation,
    scale,
    placeOnGround = !options.isEnvironmentAsset,
    groundLevel = 0,
    isEnvironmentAsset = false
  } = options;

  // 1. Auto-detect and correct orientation issues for scene/terrain assets
  // This must happen BEFORE scale detection to get accurate bounding box measurements
  const orientationResult = detectAndCorrectOrientation(entity, pc, assetDef);

  // If auto-detection found a correction, use it; otherwise check for manual override
  let orientationCorrection = orientationResult.rotation;
  if (!orientationResult.correctionApplied) {
    // No auto-correction needed - check for manual override in asset definition
    const manualCorrection = getRotationCorrection(assetDef);
    if (manualCorrection.x !== 0 || manualCorrection.y !== 0 || manualCorrection.z !== 0) {
      orientationCorrection = manualCorrection;
      console.log(`[AssetPlacement] Using manual rotation correction for "${assetDef.name}":`, manualCorrection);
    }
  }

  // Apply orientation correction temporarily for scale calculation
  if (orientationCorrection.x !== 0 || orientationCorrection.y !== 0 || orientationCorrection.z !== 0) {
    entity.setEulerAngles(orientationCorrection.x, orientationCorrection.y, orientationCorrection.z);
  }

  // 2. Determine scale - use auto-detection for environment assets
  let finalScale: number;
  let scaleInfo: { confidence: 'high' | 'medium' | 'low'; reason: string } | null = null;

  // Default fallback scale for scene assets (most are modeled in cm = 0.01)
  const SCENE_FALLBACK_SCALE = 0.01;

  if (scale !== undefined) {
    // User explicitly specified a scale - use it
    finalScale = scale;
  } else if (checkIsEnvironmentAsset(assetDef)) {
    // Environment asset (scene/terrain) - use auto-scale detection
    // First, calculate the RAW bounding box (before any scaling)
    entity.setLocalScale(1, 1, 1); // Reset to ensure we get raw dimensions
    const rawBoundingBox = calculateEntityBoundingBox(entity, pc);

    // Check if bounding box detection failed (got default 1x1x1 fallback)
    if ((rawBoundingBox as any).isDefault) {
      // Bounding box detection failed - use safe fallback scale
      finalScale = SCENE_FALLBACK_SCALE;
      scaleInfo = {
        confidence: 'low',
        reason: `Bounding box detection failed - using fallback scale ${SCENE_FALLBACK_SCALE} (assuming cm-based model)`
      };
      console.warn(`[AssetPlacement] Bounding box detection failed for "${assetDef.name}" - using fallback scale ${SCENE_FALLBACK_SCALE}`);
    } else {
      // Detect appropriate scale from actual bounding box
      const autoScaleResult = detectSceneAutoScale(assetDef, rawBoundingBox.size);
      finalScale = autoScaleResult.scale;
      scaleInfo = { confidence: autoScaleResult.confidence, reason: autoScaleResult.reason };

      console.log(`[AssetPlacement] Auto-scale detection for "${assetDef.name}":`, {
        rawSize: `${rawBoundingBox.size.x.toFixed(1)}m x ${rawBoundingBox.size.y.toFixed(1)}m x ${rawBoundingBox.size.z.toFixed(1)}m`,
        detectedScale: finalScale.toFixed(4),
        confidence: autoScaleResult.confidence,
        reason: autoScaleResult.reason
      });
    }
  } else {
    // Regular asset - use normalizedScale
    finalScale = getNormalizedScale(assetDef);
  }

  // 2. Apply the determined scale
  if (finalScale !== 1) {
    entity.setLocalScale(finalScale, finalScale, finalScale);
  }

  // 3. Calculate bounding box AFTER scaling
  const boundingBox = calculateEntityBoundingBox(entity, pc);

  // 4. Calculate final position
  let finalY = position.y;

  if (placeOnGround && !isEnvironmentAsset) {
    // For non-environment assets, place ON the ground
    finalY = calculateGroundPlacementY(boundingBox, groundLevel);
  }

  const finalPosition = {
    x: position.x,
    y: finalY,
    z: position.z
  };

  entity.setPosition(finalPosition.x, finalPosition.y, finalPosition.z);

  // 5. Apply rotation (combining user rotation with orientation correction)
  const baseRotation = rotation || getDefaultRotation(assetDef);
  // Use the orientationCorrection computed earlier (either auto-detected or manual)
  const finalRotation = {
    x: baseRotation.x + orientationCorrection.x,
    y: baseRotation.y + orientationCorrection.y,
    z: baseRotation.z + orientationCorrection.z
  };
  entity.setEulerAngles(finalRotation.x, finalRotation.y, finalRotation.z);

  // 6. Validate placement
  const expectedDimensions = getAssetDimensions(assetDef);
  const validation = validatePlacement(boundingBox, assetDef, expectedDimensions, finalScale);

  // For environment assets, add scale confidence info to validation
  if (scaleInfo && scaleInfo.confidence !== 'high') {
    validation.warnings.push(`Auto-scale confidence: ${scaleInfo.confidence} - ${scaleInfo.reason}`);
  }

  // 7. Log placement info
  const sizeRange = getSceneSizeRange(assetDef);
  console.log(`[AssetPlacement] Placed "${assetDef.name}":`, {
    position: finalPosition,
    scale: finalScale,
    dimensions: `${boundingBox.size.x.toFixed(1)}m x ${boundingBox.size.y.toFixed(1)}m x ${boundingBox.size.z.toFixed(1)}m`,
    sceneSize: assetDef.sceneSize || 'N/A',
    expectedRange: sizeRange ? `${sizeRange.min}-${sizeRange.max}m` : 'N/A',
    validation: validation.isValid ? 'OK' : validation.warnings
  });

  if (validation.warnings.length > 0) {
    console.warn(`[AssetPlacement] Warnings for "${assetDef.name}":`, validation.warnings);
    if (validation.suggestions.length > 0) {
      console.info(`[AssetPlacement] Suggestions:`, validation.suggestions);
    }
  }

  return {
    entity,
    finalPosition,
    finalScale,
    boundingBox,
    validation
  };
}

/**
 * Format placement result as user-friendly message for Hon to speak
 */
export function formatPlacementFeedback(
  assetDef: Asset3D,
  result: PlacementResult
): string {
  const { boundingBox, validation, finalPosition } = result;
  const dims = boundingBox.size;

  let feedback = `Added ${assetDef.name}`;

  // Add dimension info based on asset type
  if (assetDef.category === 'vehicle') {
    feedback += ` (${dims.z.toFixed(1)}m long, ${dims.y.toFixed(1)}m tall)`;
  } else if (assetDef.subcategory === 'scene' || assetDef.subcategory === 'terrain') {
    const footprint = Math.max(dims.x, dims.z);
    const sizeRange = getSceneSizeRange(assetDef);
    if (sizeRange) {
      feedback += ` - ${footprint.toFixed(0)}m ${assetDef.sceneSize} environment`;
    } else {
      feedback += ` - ${dims.x.toFixed(0)}m by ${dims.z.toFixed(0)}m area`;
    }
  } else if (assetDef.category === 'character') {
    feedback += ` (${dims.y.toFixed(1)}m tall)`;
  }

  // Add position info if not at origin
  if (finalPosition.x !== 0 || finalPosition.z !== 0) {
    feedback += ` at position (${finalPosition.x.toFixed(0)}, ${finalPosition.z.toFixed(0)})`;
  }

  // Add warnings (only significant ones, not auto-scale confidence)
  const significantWarnings = validation.warnings.filter(w => !w.includes('Auto-scale confidence'));
  if (significantWarnings.length > 0) {
    feedback += `. Note: ${significantWarnings[0]}`;
  }

  return feedback;
}

/**
 * Calculate suggested scale based on actual vs expected dimensions
 */
export function calculateSuggestedScale(
  currentScale: number,
  actualDimensions: { width: number; height: number; depth: number },
  expectedDimensions: RealWorldDimensions,
  matchBy: 'height' | 'width' | 'depth' | 'average' = 'height'
): number {
  let ratio: number;

  switch (matchBy) {
    case 'height':
      ratio = expectedDimensions.height / actualDimensions.height;
      break;
    case 'width':
      ratio = expectedDimensions.width / actualDimensions.width;
      break;
    case 'depth':
      ratio = expectedDimensions.depth / actualDimensions.depth;
      break;
    case 'average':
    default:
      const hRatio = expectedDimensions.height / actualDimensions.height;
      const wRatio = expectedDimensions.width / actualDimensions.width;
      const dRatio = expectedDimensions.depth / actualDimensions.depth;
      ratio = (hRatio + wRatio + dRatio) / 3;
      break;
  }

  return currentScale * ratio;
}
