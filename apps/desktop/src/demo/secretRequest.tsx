import React, { useState } from "react";
import ReactDOM from "react-dom/client";

import SecretRequest, {
  type SecretRequestStatus,
  type SecretRequestView,
} from "@/components/chat/SecretRequest";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import "../App.css";
import SecretRequests from "@/components/chat/SecretRequests";

/// Every target and every status of the one-time secret card (CBN-89), plus a
/// live card that walks pending → running → done the way the backend will.
const MIN = 60_000;

const COMMAND: SecretRequestView = {
  id: "cmd",
  purpose: "I need a GitHub token to publish the release notes as a draft release.",
  fields: [{ id: "GH_TOKEN", label: "GitHub token" }],
  target: {
    kind: "command",
    command: ["gh", "release", "create", "v1.4.0", "--draft", "--notes-file", "RELEASE NOTES.md"],
    cwd: "/Users/me/code/carbonhq",
  },
  expiresAt: Date.now() + 5 * MIN,
  status: "pending",
  keepFile: false,
};

const FILE: SecretRequestView = {
  id: "file",
  purpose: "The migration script reads database credentials from an env file.",
  fields: [
    { id: "DATABASE_URL", label: "Database URL" },
    { id: "SSH_KEY", label: "Deploy key", multiline: true },
  ],
  target: {
    kind: "file",
    path: "/Users/me/code/carbonhq/.env.local",
    command: ["pnpm", "db:migrate"],
    cwd: "/Users/me/code/carbonhq",
  },
  expiresAt: Date.now() + 45_000,
  status: "pending",
  keepFile: false,
};

const FILE_ONLY: SecretRequestView = {
  ...FILE,
  id: "file-only",
  purpose: "The dev server reads the Stripe test key from .env.local on start.",
  fields: [{ id: "STRIPE_SECRET_KEY", label: "Stripe test key" }],
  target: { kind: "file", path: "/Users/me/code/carbonhq/.env.local", command: [], cwd: "/Users/me/code/carbonhq" },
  expiresAt: Date.now() + 10 * MIN,
};

const BROWSER: SecretRequestView = {
  id: "browser",
  purpose: "Sign in to the Vercel dashboard as the team's deploy account to check the failed build.",
  fields: [
    { id: "email", label: "Email" },
    { id: "password", label: "Password" },
  ],
  target: {
    kind: "browser",
    origin: "https://vercel.com",
    fields: [
      { id: "email", selector: "input[name=email]" },
      { id: "password", selector: "input[type=password]" },
    ],
    submit: { selector: "button[type=submit]", label: "Continue" },
  },
  expiresAt: Date.now() + 3 * MIN,
  status: "pending",
  keepFile: false,
};

const SETTLED: [string, SecretRequestView][] = [
  ["running · command", { ...COMMAND, status: "running" }],
  ["running · browser", { ...BROWSER, status: "running" }],
  ["used · command", { ...COMMAND, status: "used" }],
  ["used · temp file", { ...FILE, status: "used" }],
  ["used · kept file", { ...FILE, status: "used", keepFile: true }],
  ["used · browser", { ...BROWSER, status: "used" }],
  ["failed", { ...COMMAND, status: "failed", message: "gh exited 1: HTTP 401 Bad credentials" }],
  ["denied", { ...COMMAND, status: "denied" }],
  ["cancelled", { ...BROWSER, status: "cancelled" }],
  ["expired", { ...FILE, status: "expired" }],
];

/// Stands in for the backend: submit moves to running, then to the outcome.
/// The log records names and lengths only, which is all the app may see.
function Live({
  base,
  outcome,
  reject = false,
}: {
  base: SecretRequestView;
  outcome: SecretRequestStatus;
  /// The transport refusing the submit before the backend moves `status`.
  reject?: boolean;
}) {
  const [status, setStatus] = useState<SecretRequestStatus>("pending");
  const [keepFile, setKeepFile] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  return (
    <div className="flex flex-col gap-2">
      <SecretRequest
        key={key}
        autoFocus={false}
        request={{ ...base, status, keepFile, message: status === "failed" ? "exited 1" : undefined }}
        onSubmit={(values, opts) => {
          setKeepFile(opts.keepFile);
          setLog(
            JSON.stringify({
              lengths: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.length])),
              ...opts,
            }),
          );
          if (reject) return Promise.reject(new Error("socket closed"));
          setTimeout(() => setStatus("running"), 600);
          setTimeout(() => setStatus(outcome), 2400);
        }}
        onDeny={() => setTimeout(() => setStatus("denied"), 300)}
      />
      <div className="flex items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            setStatus("pending");
            setLog(null);
            setKey((k) => k + 1);
          }}
        >
          Reset
        </Button>
        {log && <code className="text-xs text-muted-foreground">{log}</code>}
      </div>
    </div>
  );
}

function Demo() {
  return (
    <div className="flex min-h-screen flex-col gap-8 bg-background p-8 text-foreground">
      <DemoThemeBar />
      <div className="grid max-w-3xl gap-8" data-testid="cards">
        <Section title="Command · env injection">
          <Live base={COMMAND} outcome="used" />
        </Section>
        <Section title="File · temp by default, keep toggle (45s left)">
          <Live base={FILE} outcome="used" />
        </Section>
        <Section title="File · no command, keep is the hand-off">
          <Live base={FILE_ONLY} outcome="used" />
        </Section>
        <Section title="Browser · fill and submit (fails)">
          <Live base={BROWSER} outcome="failed" />
        </Section>
        <Section title="Command · transport rejects the submit">
          <Live base={{ ...COMMAND, id: "reject" }} outcome="used" reject />
        </Section>
        <Section title="Every other status">
          <div className="flex flex-col gap-4">
            {SETTLED.map(([label, request]) => (
              <div key={label} className="flex flex-col gap-1.5">
                <div className="text-xs text-muted-foreground">{label}</div>
                <SecretRequest request={request} onSubmit={() => {}} onDeny={() => {}} autoFocus={false} />
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider>
      {new URLSearchParams(location.search).get("session") ? (
        <main className="min-h-screen bg-background p-8 text-foreground">
          <DemoThemeBar />
          <div className="mx-auto flex max-w-2xl flex-col gap-6 py-6">
          <h1 className="text-lg font-medium">One-time secret hand-offs</h1>
          <SecretRequests sessionId={new URLSearchParams(location.search).get("session")!} active />
          </div>
        </main>
      ) : <Demo />}
    </TooltipProvider>
  </React.StrictMode>,
);
