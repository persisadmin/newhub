import { Wrench } from "lucide-react";
import { AuthCard } from "@/components/auth-card";

export const dynamic = "force-dynamic";

export default function MaintenancePage() {
  return (
    <AuthCard title="We'll be right back" subtitle="PERSIS is undergoing scheduled maintenance">
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-warning/10 text-warning">
          <Wrench size={22} />
        </span>
        <p className="text-sm text-muted-foreground">
          We&apos;re performing scheduled maintenance to improve your experience.
          Your projects and credits are safe — please check back shortly.
        </p>
        <p className="text-xs text-muted-foreground">
          Administrators can still sign in.
        </p>
      </div>
    </AuthCard>
  );
}
