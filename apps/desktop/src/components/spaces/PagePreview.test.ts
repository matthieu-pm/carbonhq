import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageAsset } from "@/lib/pages";

const { invoke, fileSrc } = vi.hoisted(() => ({ invoke: vi.fn(), fileSrc: vi.fn((path: string) => `safe-file:${path}`) }));
vi.mock("@/lib/transport", () => ({
  LOCAL: "local", invoke, fileSrc,
  qualify: (path: string, server: string) => server === "local" ? path : `carbon://${server}${path}`,
  splitPath: (path: string) => ({ server: "local", path }),
}));
import { pagePreviewRehypePlugins, previewPageTarget, resolvePageImage } from "./PagePreview";

function render(markdown: string) {
  return renderToStaticMarkup(createElement(Streamdown, {
    mode: "static", rehypePlugins: pagePreviewRehypePlugins, components: {
      a: ({ href, children }) => createElement("a", { href }, children),
      img: ({ src, alt }) => createElement("span", { "data-image": src }, alt),
    }, children: markdown,
  }));
}

beforeEach(() => { invoke.mockReset(); fileSrc.mockClear(); });

describe("Page preview URL and sanitization pipeline", () => {
  it("preserves Page and attachment identities through the real sanitizer", () => {
    const page = "carbon-page://local/019a1234-abcd-7000-8000-123456789abc";
    const asset = "carbon-asset://019a1234-abcd-7000-8000-123456789abc/019b1234-abcd-7000-8000-123456789abc";
    const html = render(`[Page](${page})\n\n[File](${asset})\n\n![Picture](${asset})`);
    expect(html).toContain(`#carbon-page=${encodeURIComponent(page)}`);
    expect(html).toContain(`#carbon-asset=${encodeURIComponent(asset)}`);
    expect(html).toContain(`https://carbon-asset.invalid/${encodeURIComponent(asset)}`);
  });

  it("keeps code examples literal instead of rewriting their document URLs", () => {
    const html = render("```md\n[Page](carbon-page://local/019a1234-abcd-7000-8000-123456789abc)\n```");
    expect(html).toContain("carbon-page://local/");
    expect(html).not.toContain("#carbon-page=");
  });

  it("removes script, event handlers, iframes, and active link protocols", () => {
    const html = render('<script>alert("unsafe")</script>\n\n<img src="https://example.com/a.png" onerror="alert(1)">\n\n<iframe src="https://example.com"></iframe>\n\n[Danger](javascript:alert%281%29)');
    expect(html).not.toMatch(/<script|<iframe|onerror|href="javascript:/i);
    expect(html).not.toContain("alert(&quot;unsafe&quot;)");
  });

  it("marks GFM callouts after sanitizing their contents", () => {
    const html = render("> [!WARNING]\n> Keep **this** safe");
    expect(html).toContain('data-callout="warning"');
    expect(html).toContain("spaces-preview-callout");
    expect(html).not.toContain("[!WARNING]");
  });
});

describe("Page preview owner routing", () => {
  const id = "019a1234-abcd-7000-8000-123456789abc";
  it("resolves an explicitly relative target against a remote document owner", () => {
    expect(previewPageTarget({ id, server: "local", relative: true, revision: 4 }, "remote")).toEqual({ id, server: "remote", revision: 4 });
  });
  it("keeps an absolute This Mac target local inside a remote document", () => {
    expect(previewPageTarget({ id, server: "local", revision: 4 }, "remote")).toEqual({ id, server: "local", revision: 4 });
  });
  it("preserves an explicit remote owner instead of adopting the surrounding document", () => {
    expect(previewPageTarget({ id, server: "other", revision: 2 }, "remote")).toEqual({ id, server: "other", revision: 2 });
  });
});

describe("Page image resolution", () => {
  const assets: PageAsset[] = [{ id: "a", name: "Screenshot.png", path: "/home/.carbon/attachments/pages/p/a.png", mimeType: "image/png", size: 4, url: "carbon-asset://p/a" }];

  it("resolves managed images only through their owning server", async () => {
    const original = assets[0].url;
    expect(await resolvePageImage(original, "remote", assets)).toBe(`safe-file:carbon://remote${assets[0].path}`);
    expect(assets[0].url).toBe(original);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not turn unlisted asset IDs or active URLs into file reads", async () => {
    expect(await resolvePageImage("carbon-asset://p/missing", "remote", assets)).toBeUndefined();
    expect(await resolvePageImage("javascript:alert(1)", "remote", assets)).toBeUndefined();
    expect(await resolvePageImage("data:image/svg+xml,<svg onload='alert(1)'/>", "remote", assets)).toBeUndefined();
    expect(fileSrc).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fetches Linear uploads with the Page owner's credentials", async () => {
    invoke.mockResolvedValue({ mime: "image/png", bytes: 4, dataUrl: "data:image/png;base64,AAAA" });
    const src = "https://uploads.linear.app/protected-page-probe";
    expect(await resolvePageImage(src, "remote", [])).toBe("data:image/png;base64,AAAA");
    expect(invoke).toHaveBeenCalledWith("fetch_issue_asset", { url: src }, "remote");
    expect(await resolvePageImage(src, "remote", [])).toBe("data:image/png;base64,AAAA");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("never sends credentials to a similarly named external host", async () => {
    const src = "https://uploads.linear.app.evil.test/a.png";
    expect(await resolvePageImage(src, "remote", [])).toBe(src);
    expect(invoke).not.toHaveBeenCalled();
  });
});
