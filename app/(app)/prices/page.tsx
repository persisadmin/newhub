import { PriceSubmissions } from "@/components/price-submissions";

export const metadata = { title: "My Price Library — PERSIS" };

export default function PricesPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-2">
      <h1 className="text-2xl font-bold tracking-tight">My Price Library</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Prices from your own suppliers always take priority over benchmark rates when a tender is priced.
      </p>
      <PriceSubmissions kind="quotation" />
    </div>
  );
}
