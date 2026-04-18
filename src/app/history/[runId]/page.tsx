import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { SnapshotView } from "@/components/history/SnapshotView";
import { ServiceUpdateStrip } from "@/components/onboarding/ServiceUpdateStrip";
import { getAssistantDeps } from "@/lib/assistant/deps";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({
  params
}: {
  params: Promise<{
    runId: string;
  }>;
}) {
  const { runId } = await params;
  const deps = getAssistantDeps();
  const cookieStore = await cookies();
  const user = await getCurrentUser({
    cookie: cookieStore.toString(),
    store: deps.authStore,
    now: deps.now?.()
  });

  if (!user) {
    redirect("/login");
  }

  const snapshot = await deps.historyStore.getSnapshot(runId);

  if (!snapshot || snapshot.snapshot.user_id !== user.id) {
    notFound();
  }

  return (
    <main className="page-shell">
      <ServiceUpdateStrip
        update={{
          behaviorVersion: "phase-09-ui",
          summary: "스냅샷 재열람과 현재 법령 기준 재실행 흐름이 추가되었습니다."
        }}
      />
      <SnapshotView snapshot={snapshot.snapshot} />
    </main>
  );
}
