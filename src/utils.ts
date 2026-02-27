export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function pluralize(count: number, word: string): string {
  return `${count} ${word}${count !== 1 ? "s" : ""}`;
}
