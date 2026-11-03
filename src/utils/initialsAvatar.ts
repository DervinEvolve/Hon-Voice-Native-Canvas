// Neutral avatar drawn from a name's initials, used wherever a person has no
// uploaded picture. It is an inline SVG data URL, so no image host is involved
// and no photograph of anyone is shown.

const BACKGROUNDS = ['#3b4a5a', '#4a5d4f', '#5a4a3b', '#4f4a5d', '#5d4a52', '#3f5559'];

export function initialsFrom(label: string | null | undefined): string {
  const words = String(label ?? '')
    .replace(/[^A-Za-z0-9\s_.-]/g, ' ')
    .split(/[\s_.-]+/)
    .filter(Boolean);
  const letters = words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  return letters || '?';
}

function pickBackground(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return BACKGROUNDS[hash % BACKGROUNDS.length];
}

/**
 * Returns a data URL for a round avatar showing up to two initials.
 * `label` is the display name; `seed` (defaults to the label) picks the colour.
 */
export function initialsAvatar(label: string | null | undefined, seed?: string | null): string {
  const initials = initialsFrom(label);
  const background = pickBackground(String(seed ?? label ?? ''));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="32" r="32" fill="${background}"/>` +
    `<text x="32" y="32" dy="0.35em" text-anchor="middle" font-family="Inter, Arial, sans-serif" ` +
    `font-size="24" font-weight="600" fill="#f2f2ee">${initials}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
