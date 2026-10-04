import type { ComponentType } from "react";
import DefaultLanding from "./variants/default";
import SpeedLanding from "./variants/speed";
import RiskLanding from "./variants/risk";
import RoiLanding from "./variants/roi";
import BmLajuLanding from "./variants/bm-laju";
import BmMarginLanding from "./variants/bm-margin";
import BmHargaLanding from "./variants/bm-harga";

/**
 * The landing-variant registry — the single source of truth for which landing
 * pages exist.
 *
 * Variants are code-defined components registered in a static import map (never
 * a dynamic import of an admin-supplied string). Adding a variant is: write the
 * component, import it here, add an entry. `status` is an authoring hint for
 * the admin switcher ("draft" = still being worked on); it does not gate
 * serving, because every variant is reachable at /lp/<slug> for campaign use.
 */

export interface LandingVariant {
  slug: string;
  /** Admin-facing label. */
  name: string;
  /** Admin-facing description of the angle. */
  description: string;
  status: "live" | "draft";
  /** <title> used when this variant is served at /. */
  title: string;
  metaDescription: string;
  Component: ComponentType;
}

export const DEFAULT_VARIANT_SLUG = "default";

export const LANDING_VARIANTS: LandingVariant[] = [
  {
    slug: "default",
    name: "Platform Overview",
    description: "The original page: full feature grid plus the manual-vs-PERSIS comparison.",
    status: "live",
    title: "PERSIS — Tender Analysis & Pricing Intelligence",
    metaDescription:
      "Upload a tender once. PERSIS structures the requirements, generates a BOQ, analyses pricing, and gives Malaysian contractors a transparent commercial starting point.",
    Component: DefaultLanding,
  },
  {
    slug: "speed",
    name: "Bid More Tenders",
    description: "Speed and throughput angle — time-to-submission and bidding capacity.",
    status: "live",
    title: "PERSIS — Analyse a Tender in Minutes, Not Days",
    metaDescription:
      "Upload a tender in the morning and have a priced, reviewable Bill of Quantities before lunch. Built for Malaysian contractors bidding every week.",
    Component: SpeedLanding,
  },
  {
    slug: "risk",
    name: "Protect Your Margin",
    description: "Risk angle — the cost of a pricing mistake and the safeguards that catch it.",
    status: "live",
    title: "PERSIS — Protect Your Tender Margin",
    metaDescription:
      "PERSIS flags missing prices, off-benchmark rates, weak matches and unit mismatches before you submit — and records the source of every number.",
    Component: RiskLanding,
  },
  {
    slug: "roi",
    name: "The Commercial Case",
    description: "ROI angle with package prices shown on the page (price-transparent).",
    status: "live",
    title: "PERSIS — One Tender Pays for a Year",
    metaDescription:
      "Manual tender analysis costs RM 800–2,000 in labour per tender. PERSIS packages start at RM 299, and credits never expire.",
    Component: RoiLanding,
  },
  {
    slug: "bm-laju",
    name: "Bida Lebih Banyak Tender (BM)",
    description: "Versi Bahasa Melayu — sudut kelajuan dan kapasiti membida.",
    status: "live",
    title: "PERSIS — Analisis Tender dalam Minit, Bukan Hari",
    metaDescription:
      "Muat naik tender pada waktu pagi dan dapatkan Bill of Quantities berharga sebelum tengah hari. Dibina untuk kontraktor Malaysia yang membida setiap minggu.",
    Component: BmLajuLanding,
  },
  {
    slug: "bm-margin",
    name: "Lindungi Margin Anda (BM)",
    description: "Versi Bahasa Melayu — sudut risiko dan perlindungan margin.",
    status: "live",
    title: "PERSIS — Lindungi Margin Tender Anda",
    metaDescription:
      "PERSIS membenderakan harga yang hilang, kadar menyimpang, padanan lemah dan ketidakpadanan unit sebelum anda menghantar — dan merekodkan sumber setiap angka.",
    Component: BmMarginLanding,
  },
  {
    slug: "bm-harga",
    name: "Kes Komersial (BM)",
    description: "Versi Bahasa Melayu — sudut ROI dengan harga pakej dipaparkan (telus harga).",
    status: "live",
    title: "PERSIS — Satu Tender Membayar Setahun",
    metaDescription:
      "Analisis tender manual menelan kos RM 800–2,000 buruh setiap tender. Pakej PERSIS bermula pada RM 299, dan kredit tidak pernah luput.",
    Component: BmHargaLanding,
  },
];

export const VARIANT_MAP: Record<string, LandingVariant> = Object.fromEntries(
  LANDING_VARIANTS.map((v) => [v.slug, v])
);

/**
 * Resolve a stored slug to a variant. Unknown, missing or corrupt values fall
 * back to the default variant, so a bad admin value can never break `/`.
 */
export function resolveVariant(slug?: string | null): LandingVariant {
  return (slug ? VARIANT_MAP[slug] : undefined) ?? VARIANT_MAP[DEFAULT_VARIANT_SLUG];
}
