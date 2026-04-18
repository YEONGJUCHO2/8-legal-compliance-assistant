import type { HistoryListItem } from "@/lib/assistant/ask-schema";

import { AppShell } from "@/components/shell/AppShell";

export function HomePageContent({
  initialHistory,
  serviceUpdate
}: {
  initialHistory: HistoryListItem[];
  serviceUpdate: {
    behaviorVersion: string;
    summary: string;
  };
}) {
  return <AppShell initialHistory={initialHistory} serviceUpdate={serviceUpdate} />;
}
