import SecretRequest, { type SecretRequestView } from "@/components/chat/SecretRequest";
import { denySecret, submitSecret, useSecretRequests, type SecretHandoff } from "@/lib/secrets";

function view(request: SecretHandoff): SecretRequestView {
  const { target } = request;
  return {
    id: request.id,
    agent: request.agent,
    purpose: request.purpose,
    fields: request.fields.map((field) => ({ id: field.name, label: field.label })),
    target: target.kind === "browser" ? {
      ...target,
      fields: target.fields.map((field) => ({ id: field.name, selector: field.selector })),
      submit: { selector: target.submit, label: request.submitLabel ?? undefined },
    } : { ...target, cwd: request.cwd },
    expiresAt: request.expiresAt,
    status: request.state,
    message: request.message ?? undefined,
    keepFile: request.keepFile,
    keepBlocked: request.keepBlocked ?? undefined,
  };
}

/// Hidden panes unmount the forms so a half-entered secret cannot survive navigation.
export default function SecretRequests({ sessionId, active }: { sessionId?: string; active: boolean }) {
  const requests = useSecretRequests(sessionId);
  if (!active) return null;
  return requests.map((request) => (
    <SecretRequest
      key={request.id}
      request={view(request)}
      autoFocus={active && request.id === requests.find((r) => r.state === "pending")?.id}
      onSubmit={(values, { keepFile }) => submitSecret(request, values, keepFile)}
      onDeny={() => { void denySecret(request); }}
    />
  ));
}
