"use client";

import { useState } from "react";

export function LoginForm({
  initialError
}: {
  initialError: string | null;
}) {
  const [email, setEmail] = useState("");
  const [magicUrl, setMagicUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/auth/request", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        email
      })
    });
    const json = await response.json();

    if (!response.ok) {
      setError(json.message ?? "로그인 링크를 만들지 못했습니다.");
      return;
    }

    setMagicUrl(json.magicUrl ?? null);
  }

  return (
    <section className="panel auth-panel">
      <h1>로그인 링크 요청</h1>
      <p>이메일 주소를 입력하면 개발 환경에서는 즉시 열 수 있는 magic link를 표시합니다.</p>
      <form className="auth-panel__form" onSubmit={handleSubmit}>
        <label htmlFor="email">이메일</label>
        <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <button type="submit">로그인 링크 요청</button>
      </form>
      {magicUrl ? (
        <p>
          개발용 링크: <a href={magicUrl}>{magicUrl}</a>
        </p>
      ) : null}
      {error ? <p className="auth-panel__error">{error}</p> : null}
    </section>
  );
}
