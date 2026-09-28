/** Token-similarity matching between normalised descriptions. */

export function tokenSet(s: string): Set<string> {
  return new Set(s.split(" ").filter(Boolean));
}

/** Dice coefficient on token sets, with numeric-token bonus. */
export function similarity(a: string, b: string): number {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return (2 * overlap) / (ta.size + tb.size);
}

export interface MatchCandidate<T> {
  record: T;
  confidence: number;
}

/** Return the best candidate above minConfidence, or null. */
export function bestMatch<T extends { normalisedDescription: string }>(
  query: string,
  candidates: T[],
  minConfidence: number
): MatchCandidate<T> | null {
  let best: MatchCandidate<T> | null = null;
  for (const c of candidates) {
    const score = similarity(query, c.normalisedDescription);
    if (!best || score > best.confidence) best = { record: c, confidence: score };
  }
  if (!best || best.confidence < minConfidence) return null;
  return best;
}
