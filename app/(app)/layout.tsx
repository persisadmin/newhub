import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { isMaintenanceMode } from "@/lib/services/maintenance";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Maintenance mode: halt all active sessions except admins.
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && (await isMaintenanceMode())) redirect("/maintenance");
  return (
    <AppShell userName={session.user.name ?? "User"} userEmail={session.user.email ?? ""} userRole={(session.user as { role?: string }).role}>
      {children}
    </AppShell>
  );
}
