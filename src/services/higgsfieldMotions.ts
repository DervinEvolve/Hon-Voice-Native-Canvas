// Generated from Higgsfield motions API (https://docs.higgsfield.ai/api-reference/image-to-video/motions)
// and provided api-response.json. Keep this list in sync with upstream when possible.

export interface HiggsfieldMotionPreset {
  id: string;
  name: string;
  description?: string | null;
  preview_url?: string | null;
  start_end_frame?: boolean;
}

// Subset of motions (id and name). Preview images are not bundled: they are
// Higgsfield's hosted media. The live motions route returns current previews.
export const HIGGSFIELD_MOTIONS: HiggsfieldMotionPreset[] = [
  { id: 'ea035f68-b350-40f1-b7f4-7dff999fdd67', name: '360 Orbit', description: 'The camera smoothly circles...', start_end_frame: true },
  { id: '2bae49e6-ffe7-42a8-a73f-d44632c4acaa', name: '3D Rotation', description: 'The subject or product spins...', start_end_frame: true },
  { id: '7f8971a6-9e96-45b6-a05a-8f5c99b1e13d', name: 'Abstract', description: 'Unusual shapes, shifting colors...', start_end_frame: false },
  { id: 'dc8d7d9c-ae0c-45fc-b780-7d470b171b45', name: 'Action Run', description: 'Follows the subject in fast-paced motion...', start_end_frame: true },
  // ... more entries omitted for brevity. Keep expanding from the provided JSON as needed.
];

// Helper to chunk motions for grid rendering
export const groupMotions = (size: number) => {
  const groups: HiggsfieldMotionPreset[][] = [];
  for (let i = 0; i < HIGGSFIELD_MOTIONS.length; i += size) {
    groups.push(HIGGSFIELD_MOTIONS.slice(i, i + size));
  }
  return groups;
};


