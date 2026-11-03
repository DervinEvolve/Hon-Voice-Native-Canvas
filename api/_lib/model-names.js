// Model names from request bodies end up in provider URL paths. Accept only
// names of the expected family made of safe characters.
const FAMILIES = {
  gemini: /^gemini-[a-z0-9][a-z0-9.-]{0,63}$/,
  claude: /^claude-[a-z0-9][a-z0-9.-]{0,63}$/,
};

export function checkedModelName(family, requested, fallback) {
  if (requested === undefined || requested === null || requested === '') return fallback;
  if (typeof requested !== 'string' || !FAMILIES[family]?.test(requested)) return null;
  return requested;
}
