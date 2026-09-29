import type { Metadata } from "next";
import { getLandingSettings } from "@/lib/services/landing";
import { resolveVariant } from "@/components/landing/registry";

/**
 * The marketing entry point.
 *
 * Which variant renders here is admin-controlled at runtime (Admin → Landing
 * Pages), so this route is dynamic: a statically prerendered page would bake in
 * whichever variant was active at build time and switching would do nothing.
 * The settings read is cached in-process (~30s), and falls back to the default
 * variant if the database is unreachable, so the page always renders.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const variant = resolveVariant((await getLandingSettings()).activeVariant);
  return { title: variant.title, description: variant.metaDescription };
}

export default async function LandingPage() {
  const variant = resolveVariant((await getLandingSettings()).activeVariant);
  const Component = variant.Component;
  return <Component />;
}
