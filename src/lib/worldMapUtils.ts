export const DEFAULT_MAP_TILT = 55;
export const DEFAULT_MAP_HEADING = 0;

// Altitude values optimized for Google Maps 3D Photorealistic Tiles
// Tiles only render at street-level zoom (typically < 5000m altitude)
const altitudeByType: Record<string, number> = {
  country: 4000,                    // Was 120000 - way too high for 3D tiles
  administrative_area_level_1: 3000, // Was 60000 - prefecture/state level
  administrative_area_level_2: 2000, // Was 30000 - county level
  locality: 1500,                   // Was 8000 - city level
  neighborhood: 800,                // Was 4000 - neighborhood
  point_of_interest: 400,           // Building/POI
  establishment: 300,               // Business/establishment
};

export const pickMapAltitude = (types: string[] = []): number => {
  for (const type of types) {
    if (altitudeByType[type]) return altitudeByType[type];
  }
  return 800; // Default to a reasonable street-level altitude
};

export const estimateMapRange = (viewport?: {
  north: number;
  south: number;
  east: number;
  west: number;
}): number => {
  if (!viewport) return 1500; // Reasonable default for 3D tiles
  const latSpan = Math.abs(viewport.north - viewport.south);
  const lngSpan = Math.abs(viewport.east - viewport.west);
  const maxSpan = Math.max(latSpan, lngSpan);
  // Cap the range to ensure 3D tiles can load (max ~5000m for good detail)
  return Math.min(5000, Math.max(800, maxSpan * 111000 * 0.5));
};

export const formatGeocodeError = (code: string): string => {
  switch (code) {
    case 'ZERO_RESULTS':
      return 'Couldn’t find that place. Try a more specific name.';
    case 'REQUEST_DENIED':
      return 'Maps API denied the request. Check API restrictions.';
    case 'INVALID_REQUEST':
      return 'Location search was invalid. Try again.';
    default:
      return 'Failed to resolve that location. Please try again.';
  }
};

