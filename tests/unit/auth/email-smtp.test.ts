import { describe, expect, test, vi } from "vitest";

import { createSmtpMailer } from "@/lib/auth/email-smtp";

describe("smtp mailer", () => {
  test("maps SMTP URL and TLS policy into transport config", async () => {
    const captured: unknown[] = [];

    createSmtpMailer({
      smtpUrl: "smtps://user:pass@mail.example.com",
      fromEmail: "legal@example.com",
      appBaseUrl: "https://legal.example.com",
      transportFactory(config) {
        captured.push(config);
        return {
          send: async () => {}
        };
      }
    });

    createSmtpMailer({
      smtpUrl: "smtp://user:pass@mail.example.com:587",
      fromEmail: "legal@example.com",
      transportFactory(config) {
        captured.push(config);
        return {
          send: async () => {}
        };
      }
    });

    createSmtpMailer({
      smtpUrl: "smtp://mail.example.com:25",
      fromEmail: "legal@example.com",
      transportFactory(config) {
        captured.push(config);
        return {
          send: async () => {}
        };
      }
    });

    expect(captured).toEqual([
      expect.objectContaining({
        host: "mail.example.com",
        port: 465,
        secure: true,
        requireStartTls: false,
        username: "user",
        password: "pass",
        clientHostname: "legal.example.com"
      }),
      expect.objectContaining({
        host: "mail.example.com",
        port: 587,
        secure: false,
        requireStartTls: true,
        username: "user",
        password: "pass"
      }),
      expect.objectContaining({
        host: "mail.example.com",
        port: 25,
        secure: false,
        requireStartTls: false,
        username: undefined,
        password: undefined
      })
    ]);
  });

  test("builds the expected subject and text/html magic-link body", async () => {
    const send = vi.fn(
      async (_message: {
        from: string;
        to: string;
        subject: string;
        text: string;
        html: string;
      }) => {}
    );
    const mailer = createSmtpMailer({
      smtpUrl: "smtp://mail.example.com:25",
      fromEmail: "legal@example.com",
      transportFactory() {
        return { send };
      }
    });

    await mailer.send({
      to: "user@example.com",
      expiresAt: "2026-04-18T00:15:00.000Z",
      magicUrl: "https://legal.example.com/login?token=secret-token&state=secret-state"
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "legal@example.com",
        to: "user@example.com",
        subject: "[Legal Compliance] 로그인 링크",
        text: expect.stringContaining("아래 링크로 로그인하세요."),
        html: expect.stringContaining("로그인 링크")
      })
    );

    const call = send.mock.calls[0];

    if (!call) {
      throw new Error("expected SMTP transport to receive a message");
    }

    const [message] = call;
    expect(message.text).toContain("2026-04-18T00:15:00.000Z");
    expect(message.text).toContain("https://legal.example.com/login?token=secret-token&state=secret-state");
    expect(message.html).toContain("2026-04-18T00:15:00.000Z");
    expect(message.html.match(/<a\b/gi)?.length ?? 0).toBe(1);
    expect(message.html).not.toContain("<img");
  });

  test("wraps transport failures as email_delivery_failed without leaking the token", async () => {
    const mailer = createSmtpMailer({
      smtpUrl: "smtp://mail.example.com:25",
      fromEmail: "legal@example.com",
      transportFactory() {
        return {
          send: async () => {
            throw new Error("socket closed");
          }
        };
      }
    });

    await expect(
      mailer.send({
        to: "user@example.com",
        expiresAt: "2026-04-18T00:15:00.000Z",
        magicUrl: "https://legal.example.com/login?token=secret-token&state=secret-state"
      })
    ).rejects.toMatchObject({
      code: "email_delivery_failed",
      message: expect.not.stringContaining("secret-token")
    });
  });
});
