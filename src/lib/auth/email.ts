export interface MagicLinkMailer {
  send(input: {
    to: string;
    magicUrl: string;
    expiresAt: string;
  }): Promise<void>;
}

export function redactMagicLinkUrl(magicUrl: string) {
  try {
    const url = new URL(magicUrl);

    if (url.searchParams.has("token")) {
      url.searchParams.set("token", "[redacted]");
    }

    if (url.searchParams.has("state")) {
      url.searchParams.set("state", "[redacted]");
    }

    return url.toString();
  } catch {
    return "[redacted]";
  }
}

export function createConsoleMailer(): MagicLinkMailer {
  return {
    async send({ to, magicUrl, expiresAt }) {
      console.info(`[magic-link] to=${to} expiresAt=${expiresAt} preview=${redactMagicLinkUrl(magicUrl)}`);
    }
  };
}
