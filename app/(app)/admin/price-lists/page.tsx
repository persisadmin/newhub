import { PriceSubmissions } from "@/components/price-submissions";

export const metadata = { title: "Agency Price Lists — PERSIS Admin" };

export default function AdminPriceListsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-2">
      <h1 className="text-2xl font-bold tracking-tight">Agency Price Lists</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Upload updated government agency price schedules. Committing a new version replaces that agency&rsquo;s previous rates in the benchmark library used by every project.
      </p>
      <PriceSubmissions kind="benchmark" />
    </div>
  );
}
