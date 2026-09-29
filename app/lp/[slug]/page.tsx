import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LANDING_VARIANTS, VARIANT_MAP } from "@/components/landing/registry";

/**
 * Direct URLs for every landing variant: /lp/<slug>.
 *
 * Two uses:
 *   1. Admin preview — check a variant before making it live at /.
 *   2. Campaign traffic — point an ad or email at a specific variant regardless
 *      of which one is currently active.
 *
 * These pages are statically generated from the registry (no database read) and
 * marked noindex so they cannot compete with / in search results.
 */

export const dynamicParams = false;

export function generateStaticParams() {
  return LANDING_VARIANTS.map((v) => ({ slug: v.slug }));
}

const NOINDEX: Metadata["robots"] = { index: false, follow: false };

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const variant = VARIANT_MAP[slug];
  if (!variant) return { robots: NOINDEX };
  return { title: variant.title, description: variant.metaDescription, robots: NOINDEX };
}

export default async function LandingVariantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const variant = VARIANT_MAP[slug];
  if (!variant) notFound();
  const Component = variant.Component;
  return <Component />;
}
