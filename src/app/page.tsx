import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { HomePageContent } from "@/components/shell/HomePageContent";
import { getAssistantDeps } from "@/lib/assistant/deps";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
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
    <HomePageContent
      initialHistory={history.history}
      serviceUpdate={{
        behaviorVersion: "phase-09-ui",
        summary: "질문 intake, recovery card, history, 현재 법령 재실행 UI가 추가되었습니다."
      }}
    />
  );
}
