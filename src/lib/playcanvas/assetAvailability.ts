// Weapon models, ammo and the FPS arm rigs are excluded from this build
// because their sources could not be verified (docs/PRIVATE_ASSET_QUARANTINE.json).
// Code that would load them checks this flag and skips the load instead of
// requesting files that are not there. Characters still spawn; they simply
// carry no weapon, and first-person mode shows no arms.
export const WEAPON_MODELS_AVAILABLE = false;
