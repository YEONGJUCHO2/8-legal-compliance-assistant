import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { HistoryPanel } from "@/components/history/HistoryPanel";
import { ServiceUpdateStrip } from "@/components/onboarding/ServiceUpdateStrip";
import { getAssistantDeps } from "@/lib/assistant/deps";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
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

  const history = await deps.historyStore.listRuns(user.id);

  return (
    <main className="page-shell">
      <ServiceUpdateStrip
        update={{
          behaviorVersion: "phase-09-ui",
          summary: "히스토리와 현재 법령 재실행 UI가 추가되었습니다."
        }}
      />
      <HistoryPanel history={history.history} />
    </main>
  );
}
