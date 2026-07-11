import { Suspense } from "react";
import Dashboard from "@/components/Dashboard";

function DashboardFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center text-(--muted)">
      Loading dashboard…
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<DashboardFallback />}>
      <Dashboard />
    </Suspense>
  );
}
