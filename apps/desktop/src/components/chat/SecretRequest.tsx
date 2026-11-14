import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check, CircleSlash, Eye, EyeOff, KeyRound, Lock, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { inputClassName } from "@/components/ui/input";
import Spinner from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/// Where the hand-off goes. Mirrors the backend's request metadata, so the
/// caller passes it through untouched; a change of target is a new request,
/// never an edit to this one.
export type SecretTarget =
  | { kind: "command"; command: string[]; cwd: string }
  | { kind: "file"; path: string; command: string[]; cwd: string }
  | {
      kind: "browser";
      /// Exact https origin, scheme included.
      origin: string;
      /// Which field fills which element. Shown verbatim, selectors and all.
      fields: { id: string; selector: string }[];
      /// The element clicked after filling; `label` is its visible text, if known.
      submit: { selector: string; label?: string };
    };

/// `cancelled` is the agent or its turn taking the request back. The backend
/// may fold that into `denied`; the card says "Nothing was shared" either way.
export type SecretRequestStatus =
  | "pending"
  | "running"
  | "used"
  | "failed"
  | "denied"
  | "expired"
  | "cancelled";

export type SecretField = {
  /// Key in the values map, and the variable name for a command or file.
  id: string;
  label: string;
  /// A PEM key or similar; drawn as a masked textarea.
  multiline?: boolean;
};

/// One request as the backend holds it. Never carries a value.
export type SecretRequestView = {
  id: string;
  agent?: string;
  /// The agent's own sentence: why it needs this.
  purpose: string;
  fields: SecretField[];
  target: SecretTarget;
  /// Epoch ms.
  expiresAt: number;
  status: SecretRequestStatus;
  /// Backend-written detail for `failed` (or a note on `used`). Must never
  /// contain a value; the card prints it as is.
  message?: string;
  /// What was chosen, read on terminal states. The switch always starts off.
  keepFile: boolean;
  keepBlocked?: string;
};

/// The agent asking for a credential it must not see.
///
/// Sits where the permission card sits and blocks the agent the same way, but
/// unlike that card it stays after the answer: the settled one-line summary is
/// the record of what went where, and it never holds a value.
///
/// Values exist only in the DOM. Inputs are uncontrolled, read once on submit
/// and cleared in the same tick, so no React state, draft store or re-render
/// ever holds one. A session switch that unmounts the card loses what was typed,
/// on purpose: a half-typed secret must not survive anywhere.
export default function SecretRequest({
  request,
  onSubmit,
  onDeny,
  autoFocus = true,
}: {
  request: SecretRequestView;
  /// May return a promise: a rejection (the transport failing before the
  /// backend moved `status`) draws the failed row rather than a card stuck on
  /// its spinner. Values are already cleared by then, so there is no retry.
  onSubmit: (values: Record<string, string>, opts: { keepFile: boolean }) => void | Promise<unknown>;
  onDeny: () => void;
  /// False for a split pane that does not hold focus, as on `QuestionRequest`.
  autoFocus?: boolean;
}) {
  const [rejected, setRejected] = useState(false);
  const { status, target } = request;

  if (rejected && status === "pending")
    return <Settled request={{ ...request, status: "failed", message: "Couldn't reach Carbon. Ask the agent to request it again." }} />;
  if (status !== "pending" && status !== "running") return <Settled request={request} />;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-(--shadow-card)">
      <div className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <KeyRound className="size-3.5" aria-hidden />
        {request.agent ? `${request.agent} requests a one-time secret` : "One-time secret"}
      </div>

      <Destination target={target} fields={request.fields} />

      <p className="mt-3 text-chat leading-snug wrap-anywhere">{request.purpose}</p>

      {status === "running" ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner className="size-3.5" />
          {runningLine(request)}
        </div>
      ) : (
        <PendingForm
          request={request}
          onSubmit={(values, opts) => {
            Promise.resolve().then(() => onSubmit(values, opts)).catch(() => setRejected(true));
          }}
          onDeny={onDeny}
          autoFocus={autoFocus}
        />
      )}
    </div>
  );
}

function PendingForm({
  request,
  onSubmit,
  onDeny,
  autoFocus,
}: {
  request: SecretRequestView;
  onSubmit: (values: Record<string, string>, opts: { keepFile: boolean }) => void;
  onDeny: () => void;
  autoFocus: boolean;
}) {
  const { target, fields } = request;
  const formRef = useRef<HTMLFormElement>(null);
  // Which fields hold something, never what. Enough to arm the button.
  const [filled, setFilled] = useState<Record<string, boolean>>({});
  // One-shot like the permission card: the backend consumes one answer, and
  // the round trip to `running` must not invite a second.
  const [sent, setSent] = useState<"submit" | "deny" | null>(null);
  const [keep, setKeep] = useState(false);
  const remaining = useRemaining(request.expiresAt);

  // A file with nothing to run has no temporary form: keeping it is the whole
  // hand-off, so the switch must be turned on before anything can be sent.
  const fileOnly = target.kind === "file" && target.command.length === 0;
  const keepFile = target.kind === "file" && keep;
  const expired = remaining <= 0;
  const ready =
    fields.every((field) => filled[field.id]) && !sent && !expired && (!fileOnly || keep);

  const tookFocus = useRef(false);
  useEffect(() => {
    if (expired) {
      formRef.current?.reset();
      setFilled({});
    }
  }, [expired]);
  useEffect(() => {
    if (!autoFocus || tookFocus.current) return;
    tookFocus.current = true;
    formRef.current?.querySelector<HTMLElement>("input, textarea")?.focus();
  }, [autoFocus]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const values: Record<string, string> = {};
    for (const field of fields) values[field.id] = String(data.get(field.id) ?? "");
    setSent("submit");
    form.reset();
    setFilled({});
    onSubmit(values, { keepFile });
  };

  return (
    <form ref={formRef} onSubmit={submit} autoComplete="off" className="ph-no-capture mt-3 flex flex-col gap-3">
      <div className="flex max-w-md flex-col gap-2.5">
        {fields.map((field) => (
          <MaskedField
            key={field.id}
            field={field}
            showName={target.kind !== "browser"}
            disabled={sent !== null || expired}
            onFilled={(has) => setFilled((prev) => (prev[field.id] === has ? prev : { ...prev, [field.id]: has }))}
            onCommandEnter={() => formRef.current?.requestSubmit()}
          />
        ))}
      </div>

      {target.kind === "file" && (
        <label className="flex max-w-md cursor-pointer items-start gap-2 text-sm">
          <Switch
            checked={keep}
            onCheckedChange={setKeep}
            disabled={sent !== null || !!request.keepBlocked}
            className="mt-0.5"
          />
          <span className="flex flex-col gap-0.5">
            {/* File-only already shows the path in the box above. */}
            {fileOnly ? (
              <span>Write and keep this file</span>
            ) : (
              <span>
                Keep in <span className="font-mono text-xs">{target.path}</span>
              </span>
            )}
            <span className="text-xs text-muted-foreground">{request.keepBlocked ?? keepHint(fileOnly, keep)}</span>
          </span>
        </label>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">{footnote(target, keepFile)}</p>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="submit" size="sm" className="h-7" disabled={!ready}>
          {sent === "submit" && <Spinner className="size-3.5" />}
          {submitLabel(target, keepFile)}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="h-7"
          disabled={sent !== null}
          onClick={() => {
            setSent("deny");
            formRef.current?.reset();
            setFilled({});
            onDeny();
          }}
        >
          Deny
        </Button>
        {/* Quiet and last: a deadline the reader should know of, not watch. */}
        <span
          className={cn(
            "ml-auto text-xs tabular-nums text-muted-foreground",
            remaining < 60_000 && "text-destructive",
          )}
        >
          {expired ? "Expired" : `Expires in ${formatRemaining(remaining)}`}
        </span>
      </div>
    </form>
  );
}

/// A masked input with a reveal toggle. Uncontrolled: the value is only ever
/// in the element, and `onFilled` reports emptiness alone.
function MaskedField({
  field,
  showName,
  disabled,
  onFilled,
  onCommandEnter,
}: {
  field: SecretField;
  showName: boolean;
  disabled: boolean;
  onFilled: (has: boolean) => void;
  onCommandEnter: () => void;
}) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  // Hide again once the card stops taking input, so a value revealed for a
  // check is not left on screen through the round trip.
  useEffect(() => {
    if (disabled) setRevealed(false);
  }, [disabled]);

  const shared = {
    id,
    name: field.id,
    disabled,
    autoComplete: "off",
    autoCorrect: "off",
    autoCapitalize: "off",
    spellCheck: false,
    onInput: (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onFilled(event.currentTarget.value.length > 0),
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex items-baseline gap-1.5 text-sm font-medium">
        {field.label}
        {showName && field.id !== field.label && (
          <span className="font-mono text-xs font-normal text-muted-foreground">{field.id}</span>
        )}
      </label>
      <div className="relative">
        {field.multiline ? (
          <textarea
            {...shared}
            rows={3}
            // A textarea has no password type. WebKit's text-security masks
            // it the same way, and the class drops when revealed.
            className={cn(
              inputClassName,
              "field-sizing-content h-auto max-h-40 min-h-16 resize-none py-1.5 pr-9 font-mono",
              !revealed && "[-webkit-text-security:disc]",
            )}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                onCommandEnter();
              }
            }}
          />
        ) : (
          <input
            {...shared}
            type={revealed ? "text" : "password"}
            className={cn(inputClassName, "pr-9 font-mono")}
          />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              disabled={disabled}
              aria-label={revealed ? `Hide ${field.label}` : `Show ${field.label}`}
              aria-pressed={revealed}
              className="absolute top-1 right-1 text-muted-foreground"
              onClick={() => setRevealed((r) => !r)}
            >
              {revealed ? <EyeOff /> : <Eye />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{revealed ? "Hide" : "Show"}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

/// Exactly what was approved, in the permission card's outlined box. Nothing
/// above this card is guaranteed to be on screen, so the destination has to be
/// here in full.
function Destination({ target, fields }: { target: SecretTarget; fields: SecretField[] }) {
  if (target.kind === "browser") {
    const labels = new Map(fields.map((field) => [field.id, field.label]));
    const { scheme, host } = splitOrigin(target.origin);
    return (
      <div className="rounded-lg border border-border px-3 py-2.5 text-sm">
        {/* Host carries the weight: it is the half a lookalike domain fakes. */}
        <div className="flex items-center gap-1.5 font-mono text-xs wrap-anywhere">
          <Lock className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">{scheme}</span>
          <span className="font-semibold">{host}</span>
        </div>
        {/* Selectors verbatim: they are what the fill actually targets, and a
            label alone could sit over any element on the page. */}
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {target.fields.map((binding) => (
            <Binding
              key={binding.id}
              term={labels.get(binding.id) ?? binding.id}
              selector={binding.selector}
            />
          ))}
          <Binding
            term={target.submit.label ? `Clicks “${target.submit.label}”` : "Clicks"}
            selector={target.submit.selector}
          />
        </dl>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {/* With a command the file is temporary unless kept, so its path is
          named on the Keep switch and not here, where it would read as the
          destination. */}
      {target.kind === "file" && target.command.length === 0 && (
        <pre className="overflow-x-auto rounded-lg border border-border px-3 py-2.5 font-mono text-xs">
          {target.path}
        </pre>
      )}
      {target.command.length > 0 && (
        <pre className="overflow-x-auto rounded-lg border border-border px-3 py-2.5 font-mono text-xs">
          {shellQuote(target.command)}
        </pre>
      )}
      {target.command.length > 0 && (
        <div className="font-mono text-xs wrap-anywhere text-muted-foreground">
          in {target.cwd}
        </div>
      )}
    </div>
  );
}

/// The record left behind: one row, no card, no value. Field labels and the
/// destination are safe to show; they were on the card already.
function Settled({ request }: { request: SecretRequestView }) {
  const { status, message } = request;
  const failed = status === "failed";
  const Icon = status === "used" ? Check : failed ? TriangleAlert : CircleSlash;

  return (
    <div className="flex items-start gap-2 text-sm text-muted-foreground" role="status">
      <Icon
        className={cn("mt-0.5 size-3.5 shrink-0", failed && "text-destructive")}
        aria-hidden
      />
      <div className="min-w-0 wrap-anywhere">
        <span className="font-medium text-foreground">
          {request.fields.map((f) => f.label).join(", ")}
        </span>{" "}
        {settledLine(request)}
        {message && <div className={cn("mt-0.5 text-xs", failed && "text-destructive")}>{message}</div>}
      </div>
    </div>
  );
}

function Binding({ term, selector }: { term: string; selector: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="font-mono wrap-anywhere">{selector}</dd>
    </>
  );
}

function keepHint(fileOnly: boolean, keep: boolean) {
  if (keep) return "Created new and left on disk. Must be ignored by git. Carbon won't replace an existing file.";
  if (fileOnly) return "Nothing runs, so this file is the hand-off. Turn on to write it.";
  return "Off: a temporary file only you can read, deleted after the run.";
}

function submitLabel(target: SecretTarget, keepFile: boolean) {
  if (target.kind === "browser") return "Fill and submit";
  if (target.kind === "command") return "Run with secret";
  if (target.command.length === 0) return "Keep in file";
  return keepFile ? "Save and run" : "Run with temp file";
}

function footnote(target: SecretTarget, keepFile: boolean) {
  const base = "Carbon passes the agent a reference, keeps the value out of its saved transcript and logs, and discards its copy after use. The approved command, file or website can still expose it.";
  if (target.kind === "browser")
    return `${base} You handle any MFA or CAPTCHA. It doesn't sign you out.`;
  if (keepFile || (target.kind === "file" && target.command.length === 0))
    return `${base} The file stays until you delete it. It doesn't revoke the credential.`;
  return `${base} It doesn't revoke the credential.`;
}

function runningLine({ target, keepFile }: SecretRequestView) {
  if (target.kind === "browser") return `Filling and submitting on ${splitOrigin(target.origin).host}…`;
  if (target.kind === "file" && target.command.length === 0) return `Writing ${target.path}…`;
  if (target.kind === "file" && !keepFile) return "Running with a temporary file…";
  return "Running…";
}

function settledLine({ status, target, keepFile }: SecretRequestView) {
  switch (status) {
    case "denied":
      return "declined. Nothing was shared.";
    case "cancelled":
      return "request withdrawn. Nothing was shared.";
    case "expired":
      return "request expired. Nothing was shared.";
    case "failed":
      return "hand-off failed. Carbon discarded its copy.";
    case "used":
      if (target.kind === "browser")
        return `filled and submitted on ${splitOrigin(target.origin).host}. Carbon discarded its copy.`;
      if (target.kind === "file" && keepFile)
        return `saved to ${target.path}. Carbon discarded its own copy.`;
      if (target.kind === "file") return "used once through a temporary file, now deleted.";
      return "handed to the command once. Carbon discarded its copy.";
    default:
      return "";
  }
}

/// Re-renders on a slow tick, faster in the last minute. The inputs are
/// uncontrolled, so a re-render cannot touch what is typed in them.
function useRemaining(expiresAt: number) {
  const [now, setNow] = useState(() => Date.now());
  const remaining = expiresAt - now;
  useEffect(() => {
    if (remaining <= 0) return;
    const id = setTimeout(() => setNow(Date.now()), remaining < 60_000 ? 1000 : 15_000);
    return () => clearTimeout(id);
  }, [remaining]);
  return remaining;
}

function formatRemaining(ms: number) {
  const s = Math.ceil(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.ceil(s / 60)} min`;
}

function splitOrigin(origin: string) {
  const match = /^(https?:\/\/)(.*)$/.exec(origin);
  return match ? { scheme: match[1], host: match[2] } : { scheme: "", host: origin };
}

/// argv as a reader would type it, so an argument with a space reads as one.
function shellQuote(argv: string[]) {
  return argv
    .map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`))
    .join(" ");
}
