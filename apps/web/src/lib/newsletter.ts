type Contact = { id: string; unsubscribed: boolean; properties?: Record<string, unknown> };

class ResendError extends Error {
  status: number;
  constructor(status: number) { super("Resend request failed"); this.status = status; }
}

const HEADERS = { "Cache-Control": "no-store" };
const UNAVAILABLE = "We couldn’t subscribe you right now. Please try again in a moment.";
const WELCOME_PROPERTY = "carbon_welcome";
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

/// Keeps the Resend key and segment selection out of the browser.
export async function subscribe(request: Request): Promise<Response> {
  const reply = (body: object, status = 200) => Response.json(body, { status, headers: HEADERS });
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return reply({ error: "Please subscribe from the Carbon website." }, 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return reply({ error: "Please send a valid signup form." }, 415);
  }
  if (Number(request.headers.get("content-length")) > 2048) {
    return reply({ error: "The signup form is too large." }, 413);
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 2048) return reply({ error: "The signup form is too large." }, 413);
    body = JSON.parse(text);
  } catch {
    return reply({ error: "Please send a valid signup form." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reply({ error: "Enter a valid email address." }, 400);
  }
  const input = body as Record<string, unknown>;
  if (input.website) return reply({ subscribed: true });
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return reply({ error: "Enter a valid email address." }, 400);
  }

  const key = process.env.RESEND_API_KEY?.trim();
  const segment = process.env.RESEND_NEWSLETTER_SEGMENT_ID?.trim();
  if (!key || !segment) return reply({ error: UNAVAILABLE }, 503);

  const signal = AbortSignal.timeout(10_000);
  let operation = "retrieve contact";
  async function resend(path: string, method = "GET", data?: object, headers?: Record<string, string>) {
    const options: RequestInit = {
      method, signal, cache: "no-store",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...headers },
      ...(data ? { body: JSON.stringify(data) } : {}),
    };
    let response = await fetch(`https://api.resend.com${path}`, options);
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      response = await fetch(`https://api.resend.com${path}`, options);
    }
    if (!response.ok) throw new ResendError(response.status);
    return response.json();
  }

  async function finish(contact: Contact) {
    const configuredTemplate = process.env.RESEND_WELCOME_TEMPLATE_ID?.trim();
    if (!configuredTemplate) return reply({ subscribed: true });
    let welcome = "pending";
    try {
      const property = contact.properties?.[WELCOME_PROPERTY];
      const stored = property && typeof property === "object" && "value" in property ? property.value : property;
      let previous = null;
      if (stored !== undefined && stored !== null && stored !== "") {
        try {
          if (typeof stored !== "string") throw new Error("Invalid welcome record");
          previous = JSON.parse(stored);
        } catch {
          console.error("Newsletter welcome needs reconciliation", { contactId: contact.id });
          return reply({ subscribed: true, welcome: "needs_review" });
        }
      }
      if (previous?.state === "sent" && typeof previous.emailId === "string") {
        return reply({ subscribed: true, welcome: "sent" });
      }
      const pending = previous ?? { state: "pending", startedAt: Date.now(), templateId: configuredTemplate };
      const age = Date.now() - pending.startedAt;
      if (pending.state !== "pending" || typeof pending.startedAt !== "number" || typeof pending.templateId !== "string" || age < 0 || age >= RETRY_WINDOW_MS) {
        console.error("Newsletter welcome needs reconciliation", { contactId: contact.id });
        return reply({ subscribed: true, welcome: "needs_review" });
      }
      async function save(state: object) {
        const saved = await resend(`/contacts/${encodeURIComponent(contact.id)}`, "PATCH", {
          properties: { [WELCOME_PROPERTY]: JSON.stringify(state) },
        });
        if (saved.id !== contact.id) throw new ResendError(502);
      }
      // Persist the attempt before sending; an old unknown result must never outlive Resend’s 24h deduplication window.
      if (!previous) await save(pending);
      const sent = await resend("/emails", "POST", {
        from: "Carbon <newsletter@carbonhq.sh>",
        to: [email],
        template: { id: pending.templateId },
      }, { "Idempotency-Key": `carbon-welcome/${contact.id}` });
      if (typeof sent.id !== "string") throw new ResendError(502);
      await save({ state: "sent", emailId: sent.id });
      welcome = "sent";
    } catch (error) {
      console.error("Newsletter welcome pending", { contactId: contact.id, status: error instanceof ResendError ? error.status : 503 });
    }
    return reply({ subscribed: true, welcome });
  }

  async function findContact(): Promise<Contact | null> {
    try {
      const contact = await resend(`/contacts/${encodeURIComponent(email)}`);
      if (typeof contact.id !== "string" || typeof contact.unsubscribed !== "boolean") throw new ResendError(502);
      return contact;
    } catch (error) {
      if (error instanceof ResendError && error.status === 404) return null;
      throw error;
    }
  }

  try {
    let contact = await findContact();
    if (!contact) {
      try {
        operation = "create contact";
        const created = await resend("/contacts", "POST", { email, segments: [{ id: segment }] });
        if (typeof created.id !== "string") throw new ResendError(502);
        return await finish({ id: created.id, unsubscribed: false });
      } catch (error) {
        // Another signup may have created the same contact after our lookup.
        if (!(error instanceof ResendError) || error.status !== 409) throw error;
        contact = await findContact();
        if (!contact) throw error;
      }
    }
    // A public signup must not undo an opt-out covering other Resend segments.
    if (contact.unsubscribed) {
      return reply({ error: "This address was previously unsubscribed. Contact us to rejoin." }, 409);
    }
    operation = "add contact to segment";
    const added = await resend(`/contacts/${encodeURIComponent(contact.id)}/segments/${encodeURIComponent(segment)}`, "POST");
    if (typeof added.id !== "string" || (added.audienceId !== undefined && added.audienceId !== segment)) throw new ResendError(502);
    return await finish(contact);
  } catch (error) {
    const status = error instanceof ResendError ? error.status : 503;
    console.error("Newsletter signup failed", { status, operation });
    return reply({ error: UNAVAILABLE }, 503);
  }
}
