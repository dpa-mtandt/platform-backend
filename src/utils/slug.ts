/** Turn arbitrary text into a URL-safe slug. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Produce a slug unique against `exists(slug) => boolean`, appending -2, -3, …
 * until free. Falls back to a random suffix after several tries.
 */
export async function uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base) || 'item';
  if (!(await exists(root))) return root;
  for (let i = 2; i <= 50; i++) {
    const candidate = `${root}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${root}-${Math.floor(Math.random() * 1e6)}`;
}
