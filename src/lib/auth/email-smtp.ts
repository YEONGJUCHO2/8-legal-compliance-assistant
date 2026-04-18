import os from "node:os";
import net from "node:net";
import tls from "node:tls";

import { type MagicLinkMailer } from "@/lib/auth/email";
import { AuthError } from "@/lib/auth/types";

type SmtpResponse = {
  code: number;
  lines: string[];
  message: string;
};

export type SmtpTransportConfig = {
  host: string;
  port: number;
  secure: boolean;
  requireStartTls: boolean;
  username?: string;
  password?: string;
  clientHostname: string;
};

type SmtpTransportMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

type SmtpTransport = {
  send(message: SmtpTransportMessage): Promise<void>;
};

type ResponseReader = {
  readResponse(): Promise<SmtpResponse>;
};

type ConnectedClient = {
  socket: net.Socket | tls.TLSSocket;
  reader: ResponseReader;
};

function toBase64Lines(value: string) {
  const base64 = Buffer.from(value, "utf8").toString("base64");
  return base64.replace(/.{1,76}/g, (chunk) => `${chunk}\r\n`).trimEnd();
}

function encodeMimeHeader(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildMimeMessage(message: SmtpTransportMessage) {
  const boundary = `boundary_${Math.random().toString(16).slice(2)}`;

  return [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeMimeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    toBase64Lines(message.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    toBase64Lines(message.html),
    `--${boundary}--`,
    ""
  ].join("\r\n");
}

function dotStuff(value: string) {
  return value
    .replace(/\r?\n/g, "\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

function deriveClientHostname(appBaseUrl?: string) {
  if (appBaseUrl) {
    try {
      return new URL(appBaseUrl).hostname;
    } catch {
      return os.hostname();
    }
  }

  return os.hostname();
}

export function resolveSmtpTransportConfig(smtpUrl: string, appBaseUrl?: string): SmtpTransportConfig {
  const parsed = new URL(smtpUrl);

  if (parsed.protocol !== "smtp:" && parsed.protocol !== "smtps:") {
    throw new Error(`unsupported_smtp_protocol:${parsed.protocol}`);
  }

  const port = parsed.port ? Number(parsed.port) : parsed.protocol === "smtps:" ? 465 : 25;
  const secure = parsed.protocol === "smtps:" || port === 465;

  return {
    host: parsed.hostname,
    port,
    secure,
    requireStartTls: !secure && port === 587,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    clientHostname: deriveClientHostname(appBaseUrl)
  };
}

function createResponseReader(socket: net.Socket | tls.TLSSocket): ResponseReader {
  let buffer = "";
  let partial: string[] = [];
  const queue: SmtpResponse[] = [];
  const waiters: Array<{
    resolve(response: SmtpResponse): void;
    reject(error: Error): void;
  }> = [];
  let terminalError: Error | null = null;

  const rejectAll = (error: Error) => {
    terminalError = error;

    while (waiters.length > 0) {
      waiters.shift()?.reject(error);
    }
  };

  const enqueue = (response: SmtpResponse) => {
    if (waiters.length > 0) {
      waiters.shift()?.resolve(response);
      return;
    }

    queue.push(response);
  };

  socket.setEncoding("utf8");
  socket.on("data", (chunk: string | Buffer) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");

    while (true) {
      const separatorIndex = buffer.indexOf("\r\n");

      if (separatorIndex === -1) {
        break;
      }

      const line = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      if (!line) {
        continue;
      }

      partial.push(line);

      if (/^\d{3} /.test(line)) {
        enqueue({
          code: Number(line.slice(0, 3)),
          lines: [...partial],
          message: partial.map((entry) => entry.slice(4)).join("\n")
        });
        partial = [];
      }
    }
  });
  socket.on("error", (error) => {
    rejectAll(error instanceof Error ? error : new Error(String(error)));
  });
  socket.on("end", () => {
    rejectAll(new Error("smtp_connection_ended"));
  });
  socket.on("close", (hadError) => {
    if (!hadError && !terminalError) {
      rejectAll(new Error("smtp_connection_closed"));
    }
  });

  return {
    async readResponse() {
      if (queue.length > 0) {
        return queue.shift() as SmtpResponse;
      }

      if (terminalError) {
        throw terminalError;
      }

      return new Promise<SmtpResponse>((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    }
  };
}

async function connectPlain(config: SmtpTransportConfig) {
  return new Promise<ConnectedClient>((resolve, reject) => {
    const socket = net.connect({
      host: config.host,
      port: config.port
    });

    const onError = (error: Error) => {
      socket.off("connect", onConnect);
      reject(error);
    };
    const onConnect = () => {
      socket.off("error", onError);
      resolve({
        socket,
        reader: createResponseReader(socket)
      });
    };

    socket.once("error", onError);
    socket.once("connect", onConnect);
  });
}

async function connectSecure(config: SmtpTransportConfig, socket?: net.Socket) {
  return new Promise<ConnectedClient>((resolve, reject) => {
    const secureSocket = tls.connect({
      host: socket ? undefined : config.host,
      port: socket ? undefined : config.port,
      servername: config.host,
      socket
    });

    const onError = (error: Error) => {
      secureSocket.off("secureConnect", onSecureConnect);
      reject(error);
    };
    const onSecureConnect = () => {
      secureSocket.off("error", onError);
      resolve({
        socket: secureSocket,
        reader: createResponseReader(secureSocket)
      });
    };

    secureSocket.once("error", onError);
    secureSocket.once("secureConnect", onSecureConnect);
  });
}

async function expectResponse(reader: ResponseReader, expectedCodes: number[], command?: string) {
  const response = await reader.readResponse();

  if (!expectedCodes.includes(response.code)) {
    throw new Error(`smtp_command_failed:${command ?? "response"}:${response.code}:${response.message}`);
  }

  return response;
}

async function sendCommand(client: ConnectedClient, command: string, expectedCodes: number[]) {
  client.socket.write(`${command}\r\n`);
  return expectResponse(client.reader, expectedCodes, command);
}

function parseCapabilities(response: SmtpResponse) {
  return response.lines.map((line) => line.slice(4));
}

async function sendEhlo(client: ConnectedClient, clientHostname: string) {
  const response = await sendCommand(client, `EHLO ${clientHostname}`, [250]);
  return parseCapabilities(response);
}

async function authenticate(client: ConnectedClient, config: SmtpTransportConfig, capabilities: string[]) {
  if (!config.username) {
    return;
  }

  const authLine = capabilities.find((line) => line.toUpperCase().startsWith("AUTH "));
  const methods =
    authLine
      ?.split(/\s+/)
      .slice(1)
      .map((value) => value.toUpperCase()) ?? ["PLAIN"];

  if (methods.includes("PLAIN")) {
    const payload = Buffer.from(`\u0000${config.username}\u0000${config.password ?? ""}`, "utf8").toString("base64");
    await sendCommand(client, `AUTH PLAIN ${payload}`, [235]);
    return;
  }

  if (methods.includes("LOGIN")) {
    await sendCommand(client, "AUTH LOGIN", [334]);
    await sendCommand(client, Buffer.from(config.username, "utf8").toString("base64"), [334]);
    await sendCommand(client, Buffer.from(config.password ?? "", "utf8").toString("base64"), [235]);
    return;
  }

  throw new Error("smtp_auth_unsupported");
}

function createNodeSmtpTransport(config: SmtpTransportConfig): SmtpTransport {
  return {
    async send(message) {
      let client = config.secure ? await connectSecure(config) : await connectPlain(config);

      try {
        await expectResponse(client.reader, [220]);

        let capabilities = await sendEhlo(client, config.clientHostname);

        if (config.requireStartTls) {
          if (!capabilities.some((line) => line.toUpperCase() === "STARTTLS")) {
            throw new Error("smtp_starttls_unavailable");
          }

          await sendCommand(client, "STARTTLS", [220]);
          client = await connectSecure(config, client.socket as net.Socket);
          capabilities = await sendEhlo(client, config.clientHostname);
        }

        await authenticate(client, config, capabilities);
        await sendCommand(client, `MAIL FROM:<${message.from}>`, [250]);
        await sendCommand(client, `RCPT TO:<${message.to}>`, [250, 251]);
        await sendCommand(client, "DATA", [354]);

        client.socket.write(`${dotStuff(buildMimeMessage(message))}\r\n.\r\n`);
        await expectResponse(client.reader, [250], "DATA_BODY");
        await sendCommand(client, "QUIT", [221]);
      } finally {
        client.socket.end();
      }
    }
  };
}

function buildMagicLinkMessage(fromEmail: string, to: string, magicUrl: string, expiresAt: string): SmtpTransportMessage {
  return {
    from: fromEmail,
    to,
    subject: "[Legal Compliance] 로그인 링크",
    text: `아래 링크로 로그인하세요. 만료: ${expiresAt}\n${magicUrl}\n링크를 타인에게 공유하지 마세요.`,
    html: [
      "<html><body>",
      "<p>아래 링크로 로그인하세요.</p>",
      `<p>만료: ${escapeHtml(expiresAt)}</p>`,
      `<p><a href="${escapeHtml(magicUrl)}">로그인 링크</a></p>`,
      "<p>링크를 타인에게 공유하지 마세요.</p>",
      "</body></html>"
    ].join("")
  };
}

export function createSmtpMailer({
  smtpUrl,
  fromEmail,
  appBaseUrl,
  transportFactory = createNodeSmtpTransport
}: {
  smtpUrl: string;
  fromEmail: string;
  appBaseUrl?: string;
  transportFactory?: (config: SmtpTransportConfig) => SmtpTransport;
}): MagicLinkMailer {
  const transport = transportFactory(resolveSmtpTransportConfig(smtpUrl, appBaseUrl));

  return {
    async send({ to, magicUrl, expiresAt }) {
      try {
        await transport.send(buildMagicLinkMessage(fromEmail, to, magicUrl, expiresAt));
      } catch {
        throw new AuthError("email_delivery_failed", "Magic link email delivery failed");
      }
    }
  };
}
