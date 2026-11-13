import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { subscribe } from "../src/lib/newsletter.ts";

const originalKey = process.env.RESEND_API_KEY;
const originalSegment = process.env.RESEND_NEWSLETTER_SEGMENT_ID;
const originalWelcome = process.env.RESEND_WELCOME_TEMPLATE_ID;
const segment = "newsletter-segment";

beforeEach(() => {
  process.env.RESEND_API_KEY = "test-private-key";
  process.env.RESEND_NEWSLETTER_SEGMENT_ID = segment;
  delete process.env.RESEND_WELCOME_TEMPLATE_ID;
  mock.method(console, "error", () => {});
});
afterEach(() => {
  mock.restoreAll();
  for (const [name, value] of [["RESEND_API_KEY", originalKey], ["RESEND_NEWSLETTER_SEGMENT_ID", originalSegment], ["RESEND_WELCOME_TEMPLATE_ID", originalWelcome]]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function request(body = { email: "reader@example.com" }, headers = {}) {
  return new Request("https://carbonhq.sh/api/newsletter", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://carbonhq.sh", ...headers },
    body: JSON.stringify(body),
  });
}

function upstream(...responses) {
  return mock.method(globalThis, "fetch", async () => {
    assert.ok(responses.length, "Unexpected extra Resend request");
    const [status, body] = responses.shift();
    return Response.json(body, { status });
  });
}

test("rejects invalid input and cross-site requests without calling Resend", async () => {
  const fetch = upstream();
  for (const body of [{}, { email: "invalid" }, { email: 12 }, null, [], { email: `${"a".repeat(250)}@example.com` }]) {
    assert.equal((await subscribe(request(body))).status, 400);
  }
  assert.equal((await subscribe(request(undefined, { Origin: "https://other.test" }))).status, 403);
  assert.equal((await subscribe(request(undefined, { "Sec-Fetch-Site": "cross-site" }))).status, 403);
  assert.equal((await subscribe(request(undefined, { "Content-Type": "text/plain" }))).status, 415);
  assert.equal(fetch.mock.callCount(), 0);
});

test("rejects malformed and oversized bodies", async () => {
  const fetch = upstream();
  assert.equal((await subscribe(new Request("https://carbonhq.sh/api/newsletter", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
  }))).status, 400);
  assert.equal((await subscribe(request({ email: "a".repeat(2100) }))).status, 413);
  assert.equal((await subscribe(request(undefined, { "Content-Length": "3000" }))).status, 413);
  assert.equal(fetch.mock.callCount(), 0);
});

test("ignores honeypot submissions without adding contacts", async () => {
  const fetch = upstream();
  assert.equal((await subscribe(request({ email: "reader@example.com", website: "spam.test" }))).status, 200);
  assert.equal(fetch.mock.callCount(), 0);
});

test("fails closed when credentials or segment are missing", async () => {
  const fetch = upstream();
  delete process.env.RESEND_NEWSLETTER_SEGMENT_ID;
  assert.equal((await subscribe(request())).status, 503);
  process.env.RESEND_NEWSLETTER_SEGMENT_ID = segment;
  delete process.env.RESEND_API_KEY;
  assert.equal((await subscribe(request())).status, 503);
  assert.equal(fetch.mock.callCount(), 0);
});

test("creates a normalized subscriber in the configured segment", async () => {
  const fetch = upstream([404, {}], [201, { id: "contact" }]);
  const response = await subscribe(request({ email: " Reader+news@Example.COM " }));
  assert.deepEqual(await response.json(), { subscribed: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  const [url, options] = fetch.mock.calls[1].arguments;
  assert.equal(url, "https://api.resend.com/contacts");
  assert.equal(options.headers.Authorization, "Bearer test-private-key");
  assert.deepEqual(JSON.parse(options.body), { email: "reader+news@example.com", segments: [{ id: segment }] });
  assert.equal(options.method, "POST");
});

test("repeat signup adds an existing subscribed contact to the segment", async () => {
  const fetch = upstream([200, { id: "contact", unsubscribed: false }], [200, { id: segment }]);
  assert.equal((await subscribe(request())).status, 200);
  const [url, options] = fetch.mock.calls[1].arguments;
  assert.equal(url, `https://api.resend.com/contacts/contact/segments/${segment}`);
  assert.equal(options.method, "POST");
  assert.equal(options.body, undefined);
});

test("accepts Resend’s membership response with a separate audienceId", async () => {
  upstream([200, { id: "contact", unsubscribed: false }], [201, { id: "membership", audienceId: segment }]);
  assert.equal((await subscribe(request())).status, 200);
});

test("does not undo an account-wide unsubscribe", async () => {
  const fetch = upstream([200, { id: "contact", unsubscribed: true }]);
  const response = await subscribe(request());
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /previously unsubscribed/);
  assert.equal(fetch.mock.callCount(), 1);
});

test("recovers from another signup creating the contact during our lookup", async () => {
  upstream([404, {}], [409, {}], [200, { id: "contact", unsubscribed: false }], [200, { id: segment }]);
  assert.equal((await subscribe(request())).status, 200);
});

test("does not report success after a failed or malformed segment assignment", async () => {
  for (const result of [[500, {}], [429, {}], [200, {}], [201, { id: "membership", audienceId: "wrong-segment" }]]) {
    const fetch = upstream([200, { id: "contact", unsubscribed: false }], result);
    assert.equal((await subscribe(request())).status, 503);
    fetch.mock.restore();
  }
});

test("does not expose provider errors, credentials, or email addresses", async () => {
  upstream([401, { message: "test-private-key reader@example.com" }]);
  const response = await subscribe(request());
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.doesNotMatch(body, /test-private-key|reader@example.com/);
  assert.doesNotMatch(JSON.stringify(console.error.mock.calls), /test-private-key|reader@example.com/);
});

test("network timeouts allow the visitor to retry", async () => {
  mock.method(globalThis, "fetch", async () => { throw new DOMException("Timed out", "TimeoutError"); });
  assert.equal((await subscribe(request())).status, 503);
});

test("rejects malformed success responses from Resend", async () => {
  const fetch = upstream([200, { id: "contact" }]);
  assert.equal((await subscribe(request())).status, 503);
  assert.equal(fetch.mock.callCount(), 1);
});

test("new signup persists a welcome attempt, sends with a stable key, and records the email", async () => {
  process.env.RESEND_WELCOME_TEMPLATE_ID = "welcome-template";
  const fetch = upstream([404, {}], [201, { id: "contact" }], [200, { id: "contact" }], [200, { id: "email" }], [200, { id: "contact" }]);
  const response = await subscribe(request());
  assert.deepEqual(await response.json(), { subscribed: true, welcome: "sent" });
  const claim = JSON.parse(fetch.mock.calls[2].arguments[1].body);
  assert.equal(JSON.parse(claim.properties.carbon_welcome).state, "pending");
  const [url, options] = fetch.mock.calls[3].arguments;
  assert.equal(url, "https://api.resend.com/emails");
  assert.equal(options.headers["Idempotency-Key"], "carbon-welcome/contact");
  assert.deepEqual(JSON.parse(options.body), { from: "Carbon <newsletter@carbonhq.sh>", to: ["reader@example.com"], template: { id: "welcome-template" } });
  const receipt = JSON.parse(fetch.mock.calls[4].arguments[1].body);
  assert.deepEqual(JSON.parse(receipt.properties.carbon_welcome), { state: "sent", emailId: "email" });
});

test("repeat subscriptions never resend a recorded welcome", async () => {
  process.env.RESEND_WELCOME_TEMPLATE_ID = "welcome-template";
  const fetch = upstream([200, { id: "contact", unsubscribed: false, properties: { carbon_welcome: JSON.stringify({ state: "sent", emailId: "email" }) } }], [201, { id: "membership", audienceId: segment }]);
  const response = await subscribe(request());
  assert.deepEqual(await response.json(), { subscribed: true, welcome: "sent" });
  assert.equal(fetch.mock.callCount(), 2);
});

test("reads welcome receipts from Resend’s wrapped contact properties", async () => {
  process.env.RESEND_WELCOME_TEMPLATE_ID = "welcome-template";
  const fetch = upstream([200, { id: "contact", unsubscribed: false, properties: { carbon_welcome: { type: "string", value: JSON.stringify({ state: "sent", emailId: "email" }) } } }], [200, { id: segment }]);
  assert.deepEqual(await (await subscribe(request())).json(), { subscribed: true, welcome: "sent" });
  assert.equal(fetch.mock.callCount(), 2);
});

test("does not send again when a persisted welcome record cannot be decoded", async () => {
  process.env.RESEND_WELCOME_TEMPLATE_ID = "welcome-template";
  const fetch = upstream([200, { id: "contact", unsubscribed: false, properties: { carbon_welcome: { type: "string", value: "not-json" } } }], [200, { id: segment }]);
  assert.deepEqual(await (await subscribe(request())).json(), { subscribed: true, welcome: "needs_review" });
  assert.equal(fetch.mock.callCount(), 2);
});

test("an unknown welcome result retries the original template and idempotency key", async () => {
  process.env.RESEND_WELCOME_TEMPLATE_ID = "new-template";
  const pending = { state: "pending", startedAt: Date.now() - 1000, templateId: "original-template" };
  const fetch = upstream([200, { id: "contact", unsubscribed: false, properties: { carbon_welcome: JSON.stringify(pending) } }], [200, { id: segment }], [200, { id: "original-email" }], [200, { id: "contact" }]);
  assert.equal((await subscribe(request())).status, 200);
  const [, options] = fetch.mock.calls[2].arguments;
  assert.equal(options.headers["Idempotency-Key"], "carbon-welcome/contact");
  assert.equal(JSON.parse(options.body).template.id, "original-template");
});

test("an expired or malformed pending welcome requires reconciliation instead of another send", async () => {
  process.env.RESEND_WELCOME_TEMPLATE_ID = "welcome-template";
  for (const pending of [{ state: "pending", startedAt: Date.now() - 24 * 60 * 60 * 1000, templateId: "template" }, { state: "pending", startedAt: "invalid", templateId: "template" }]) {
    const fetch = upstream([200, { id: "contact", unsubscribed: false, properties: { carbon_welcome: JSON.stringify(pending) } }], [200, { id: segment }]);
    const response = await subscribe(request());
    assert.deepEqual(await response.json(), { subscribed: true, welcome: "needs_review" });
    assert.equal(fetch.mock.callCount(), 2);
    fetch.mock.restore();
  }
});

test("a send failure keeps the successful subscription and pending receipt", async () => {
  process.env.RESEND_WELCOME_TEMPLATE_ID = "welcome-template";
  const fetch = upstream([404, {}], [201, { id: "contact" }], [200, { id: "contact" }], [503, {}]);
  const response = await subscribe(request());
  assert.deepEqual(await response.json(), { subscribed: true, welcome: "pending" });
  assert.equal(fetch.mock.callCount(), 4);
});

test("failure to persist the attempt prevents sending", async () => {
  process.env.RESEND_WELCOME_TEMPLATE_ID = "welcome-template";
  const fetch = upstream([404, {}], [201, { id: "contact" }], [503, {}]);
  assert.deepEqual(await (await subscribe(request())).json(), { subscribed: true, welcome: "pending" });
  assert.equal(fetch.mock.callCount(), 3);
});

test("an accepted email with a failed receipt update stays safe to retry", async () => {
  process.env.RESEND_WELCOME_TEMPLATE_ID = "welcome-template";
  const fetch = upstream([404, {}], [201, { id: "contact" }], [200, { id: "contact" }], [200, { id: "email" }], [503, {}]);
  assert.deepEqual(await (await subscribe(request())).json(), { subscribed: true, welcome: "pending" });
  assert.equal(fetch.mock.callCount(), 5);
});

test("a rate-limited provider request is retried once", async () => {
  const fetch = upstream([429, {}], [200, { id: "contact", unsubscribed: false }], [200, { id: segment }]);
  assert.equal((await subscribe(request())).status, 200);
  assert.equal(fetch.mock.callCount(), 3);
});
