import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return (
    <AppShell userName={session.user.name ?? "User"} userEmail={session.user.email ?? ""} userRole={(session.user as { role?: string }).role}>
      {children}
    </AppShell>
  );
}
