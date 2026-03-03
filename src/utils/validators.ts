export function isValidPackageName(input: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(input);
}

export function isValidVersionCode(input: string): boolean {
  return /^\d+$/.test(input);
}

export function toSafeFileStem(input: string): string {
  const normalized = input
    .trim()
    .replace(/[\/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  return normalized || 'modded';
}
