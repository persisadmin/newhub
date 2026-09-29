/**
 * Customer-facing credit packages — the single source of truth for what a
 * customer buys and what they get.
 *
 * Pure data with no server imports, so it is safe to use from client
 * components (settings page), server components (landing variants) and the
 * billing service alike. Prices are in sen (MYR cents).
 *
 * 1 credit = RM 1. Credits never expire; each purchase also activates a
 * 30-day subscription (uploads and processing require an active one).
 */

export const PACKAGES = {
  starter: { name: "Starter", price: 29900, credits: 300 },
  professional: { name: "Professional", price: 49900, credits: 550 },
  enterprise: { name: "Enterprise", price: 99900, credits: 1200 },
} as const;

export type PackageKey = keyof typeof PACKAGES;

export interface Package {
  key: PackageKey;
  name: string;
  /** Price in sen. */
  price: number;
  credits: number;
}

/** Stable, ordered list for rendering (starter → professional → enterprise). */
export const PACKAGE_LIST: Package[] = (Object.keys(PACKAGES) as PackageKey[]).map((key) => ({
  key,
  ...PACKAGES[key],
}));

/** Format a sen amount as whole-ringgit MYR (package prices are whole ringgit). */
export function formatPackagePrice(sen: number): string {
  return `RM ${(sen / 100).toLocaleString("en-MY", { maximumFractionDigits: 0 })}`;
}
