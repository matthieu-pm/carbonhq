import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const script = readFileSync(new URL("../../src-tauri/src/browser/secret_form.js", import.meta.url), "utf8");

function page() {
  const form = {
    action: "https://example.com/login", method: "post", isConnected: true,
    reportValidity: () => true,
    requestSubmit: () => { submissions.push(input.value); },
  };
  class Input {
    type = "password";
    form = form;
    disabled = false;
    readOnly = false;
    isConnected = true;
    style = {};
    private text = "";
    get value() { return this.text; }
    set value(value: string) { this.text = value; }
    checkVisibility() { return true; }
    setAttribute() {}
    dispatchEvent() {}
  }
  class Button {
    type = "submit";
    disabled = false;
    form = form;
    isConnected = true;
    innerText = "Sign in";
    checkVisibility() { return true; }
    getAttribute() { return null; }
  }
  const input = new Input();
  const button = new Button();
  const submissions: string[] = [];
  const window = {};
  const target = { origin: "https://example.com", fields: [{ name: "PASSWORD", selector: "#password" }], submit: "button" };
  const globals = {
    window, location: { origin: target.origin, protocol: "https:", href: `${target.origin}/login` },
    document: { querySelectorAll: (selector: string) => selector === "#password" ? [input] : [button] },
    HTMLInputElement: Input, HTMLButtonElement: Button, URL, Event,
  };
  const run = (request: object, nonce: string) => runInNewContext(`(${script})(request, nonce)`, { ...globals, request: { sessionId: "session", target, ...request }, nonce });
  return { run, form, input, submissions, globals };
}

describe("browser secret form approvals", () => {
  it("keeps two approvals valid on the same unchanged document", () => {
    const p = page();
    const first = p.run({ action: "prepare" }, "first-request");
    const second = p.run({ action: "prepare" }, "second-request");
    expect(first.document).toBe(second.document);
    expect(p.run({ action: "submit", prepared: first, values: { PASSWORD: "first-synthetic" } }, "unused").ok).toBe(true);
    expect(p.run({ action: "submit", prepared: second, values: { PASSWORD: "second-synthetic" } }, "unused").ok).toBe(true);
    expect(p.submissions).toEqual(["first-synthetic", "second-synthetic"]);
  });

  it("still refuses a changed form destination before filling", () => {
    const p = page();
    const prepared = p.run({ action: "prepare" }, "request");
    p.form.action = "https://other.example/login";
    expect(p.run({ action: "submit", prepared, values: { PASSWORD: "synthetic" } }, "unused").ok).toBe(false);
    expect(p.input.value).toBe("");
    expect(p.submissions).toEqual([]);
  });

  it("refuses an approval after the document is replaced", () => {
    const p = page();
    const prepared = p.run({ action: "prepare" }, "request");
    p.globals.window = {};
    expect(p.run({ action: "submit", prepared, values: { PASSWORD: "synthetic" } }, "unused").ok).toBe(false);
    expect(p.input.value).toBe("");
  });
});
