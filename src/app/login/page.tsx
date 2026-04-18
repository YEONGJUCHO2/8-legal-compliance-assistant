import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{
    error?: string;
    token?: string;
    state?: string;
  }>;
}) {
  const params = await searchParams;

  if (params.token && params.state) {
    redirect(`/api/auth/callback?token=${encodeURIComponent(params.token)}&state=${encodeURIComponent(params.state)}`);
  }

  return (
    <main className="page-shell">
      <LoginForm initialError={params.error ?? null} />
    </main>
  );
}
