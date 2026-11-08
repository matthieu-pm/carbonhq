import { memo, useEffect, useMemo, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { Streamdown, type Components, type MathPlugin, type DiagramPlugin, type StreamdownProps, type ThemeInput } from "streamdown";
import { Download, File, FileImage, FileText, Loader2 } from "lucide-react";
import { IssueFile, IssueImage } from "@/components/IssueAsset";
import { MarkdownTable } from "@/components/chat/MarkdownTable";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCodeThemeWithMode } from "@/hooks/useCodeTheme";
import { createSharedCodePlugin } from "@/lib/codePlugin";
import { formatBytes } from "@/lib/format";
import { issueGeneration, subscribeIssueGeneration } from "@/lib/issue";
import { REHYPE_PLUGINS } from "@/lib/markdownPlugins";
import { openLink } from "@/lib/openLink";
import { parsePageUrl, type PageAsset, type PageTarget } from "@/lib/pages";
import { fileSrc, invoke, LOCAL, qualify } from "@/lib/transport";
import type { IssueAsset } from "@/types/events";
import "katex/dist/katex.min.css";
import "./page-preview.css";

type Props = { markdown: string; server: string; assets: PageAsset[]; onOpenPage?: (target: PageTarget) => void };
type Hast = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Hast[] };
const ASSET_IMAGE_PREFIX = "https://carbon-asset.invalid/";
const ASSET_FRAGMENT = "#carbon-asset=";
const PAGE_FRAGMENT = "#carbon-page=";
const ISSUE_CACHE_LIMIT = 16 * 1024 * 1024;
const issueCache = new Map<string, { generation: number; asset: IssueAsset | null }>();
const issueRequests = new Map<string, Promise<IssueAsset | null>>();
let issueCacheBytes = 0;

function isLinearUpload(url: string) {
  try { const parsed = new URL(url); return parsed.protocol === "https:" && parsed.host === "uploads.linear.app"; } catch { return false; }
}

function decodeAssetUrl(value: string): string {
  const encoded = value.startsWith(ASSET_IMAGE_PREFIX) ? value.slice(ASSET_IMAGE_PREFIX.length) : value.startsWith(ASSET_FRAGMENT) ? value.slice(ASSET_FRAGMENT.length) : null;
  if (encoded === null) return value;
  try { return decodeURIComponent(encoded); } catch { return ""; }
}

function cacheIssueAsset(key: string, asset: IssueAsset | null, generation: number) {
  const old = issueCache.get(key);
  issueCacheBytes -= old?.asset?.dataUrl.length ?? 0;
  issueCache.delete(key);
  if ((asset?.dataUrl.length ?? 0) > ISSUE_CACHE_LIMIT) return;
  issueCache.set(key, { generation, asset });
  issueCacheBytes += asset?.dataUrl.length ?? 0;
  while (issueCacheBytes > ISSUE_CACHE_LIMIT) {
    const first = issueCache.keys().next().value;
    if (first === undefined) break;
    issueCacheBytes -= issueCache.get(first)?.asset?.dataUrl.length ?? 0;
    issueCache.delete(first);
  }
}

function loadIssueAsset(url: string, server: string): Promise<IssueAsset | null> {
  const key = `${server}\n${url}`;
  const generation = issueGeneration();
  const cached = issueCache.get(key);
  if (cached?.generation === generation) return Promise.resolve(cached.asset);
  const requestKey = `${generation}\n${key}`;
  const running = issueRequests.get(requestKey);
  if (running) return running;
  const request = invoke<IssueAsset>("fetch_issue_asset", { url }, server).catch(() => null).then((asset) => {
    cacheIssueAsset(key, asset, generation);
    issueRequests.delete(requestKey);
    return asset;
  });
  issueRequests.set(requestKey, request);
  return request;
}

/// Display URLs are resolved at the owner; the document always keeps its stable original URL.
export async function resolvePageImage(src: string, server: string, assets: PageAsset[]): Promise<string | undefined> {
  const original = decodeAssetUrl(src);
  const asset = assets.find((item) => item.url === original);
  if (asset) return asset.mimeType.startsWith("image/") ? fileSrc(qualify(asset.path, server)) : undefined;
  if (original.startsWith("carbon-asset:")) return undefined;
  if (isLinearUpload(original)) {
    const fetched = await loadIssueAsset(original, server);
    return fetched?.mime.startsWith("image/") ? fetched.dataUrl : undefined;
  }
  return /^(?:https?:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(original) ? original : undefined;
}

/// Custom document URLs cross the standard sanitizer as inert markers and resolve only in our renderers.
function rehypePageUrls() {
  return (tree: Hast) => {
    const walk = (node: Hast) => {
      if (node.tagName === "a") {
        const href = node.properties?.href;
        if (typeof href === "string" && href.startsWith("carbon-page:") && parsePageUrl(href)) node.properties!.href = `${PAGE_FRAGMENT}${encodeURIComponent(href)}`;
        else if (typeof href === "string" && href.startsWith("carbon-asset:")) node.properties!.href = `${ASSET_FRAGMENT}${encodeURIComponent(href)}`;
      }
      if (node.tagName === "img") {
        const src = node.properties?.src;
        if (typeof src === "string" && src.startsWith("carbon-asset:")) node.properties!.src = `${ASSET_IMAGE_PREFIX}${encodeURIComponent(src)}`;
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}

function rehypePageCallouts() {
  return (tree: Hast) => {
    const walk = (node: Hast) => {
      if (node.tagName === "blockquote") {
        const paragraph = node.children?.find((child) => child.tagName === "p");
        const text = paragraph?.children?.find((child) => child.type === "text");
        const match = typeof text?.value === "string" ? /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s*\n|\s*$)/i.exec(text.value) : null;
        if (match && text) { text.value = text.value!.slice(match[0].length); node.properties = { ...node.properties, className: ["spaces-preview-callout"], "data-callout": match[1].toLowerCase() }; }
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}

// Keep the existing raw/sanitize/harden stack; Page URL markers precede sanitization.
export const pagePreviewRehypePlugins = [REHYPE_PLUGINS![0], rehypePageUrls, ...REHYPE_PLUGINS!.slice(1), rehypePageCallouts] as StreamdownProps["rehypePlugins"];
let mathPromise: Promise<MathPlugin> | null = null;
let mermaidPromise: Promise<DiagramPlugin> | null = null;
function loadMath() {
  mathPromise ??= import("@streamdown/math").then(({ createMathPlugin }) => {
    const plugin = createMathPlugin({ singleDollarTextMath: true, errorColor: "var(--destructive)" });
    const [rehype, options] = plugin.rehypePlugin as [unknown, Record<string, unknown>];
    return { ...plugin, rehypePlugin: [rehype, { ...options, trust: false, strict: "warn" }] } as MathPlugin;
  });
  return mathPromise;
}
function loadMermaid() {
  mermaidPromise ??= import("@streamdown/mermaid").then(({ createMermaidPlugin }) => createMermaidPlugin({ config: { securityLevel: "strict", startOnLoad: false, suppressErrorRendering: true, maxTextSize: 50000, secure: ["securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "secure"] } }));
  return mermaidPromise;
}

function MediaImage({ src, alt, server, assets }: { src: string; alt: string; server: string; assets: PageAsset[] }) {
  const [resolved, setResolved] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const generation = useSyncExternalStore(subscribeIssueGeneration, issueGeneration, issueGeneration);
  useEffect(() => {
    let live = true;
    setFailed(false); setResolved(undefined);
    void resolvePageImage(src, server, assets).then((next) => { if (live) { setResolved(next); setFailed(!next); } });
    return () => { live = false; };
  }, [src, server, assets, generation]);
  const asset = assets.find((item) => item.url === decodeAssetUrl(src));
  if (failed) return <span className="spaces-preview-unavailable"><FileImage size={16} />{alt || asset?.name || "Image unavailable"}</span>;
  if (!resolved) return <span className="spaces-preview-image-loading" aria-label="Loading image"><Loader2 className="animate-spin" size={18} /></span>;
  return <><button type="button" className="spaces-preview-image" onClick={() => setOpen(true)} aria-label={`Open ${alt || asset?.name || "image"}`}><img src={resolved} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} /></button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-5xl"><DialogHeader><DialogTitle>{asset?.name || alt || "Image"}</DialogTitle><DialogDescription>Image preview</DialogDescription></DialogHeader><img src={resolved} alt={alt} className="max-h-[72vh] max-w-full object-contain" /></DialogContent></Dialog></>;
}

function RemoteIssueFile({ href, name, server }: { href: string; name: string; server: string }) {
  const [asset, setAsset] = useState<IssueAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useSyncExternalStore(subscribeIssueGeneration, issueGeneration, issueGeneration);
  useEffect(() => {
    let live = true;
    setAsset(null); setLoading(true);
    void loadIssueAsset(href, server).then((next) => { if (live) { setAsset(next); setLoading(false); } });
    return () => { live = false; };
  }, [href, server, generation]);
  return <button type="button" disabled={!asset} className="spaces-preview-asset-link" onClick={() => {
    if (!asset) return;
    const anchor = document.createElement("a"); anchor.href = asset.dataUrl; anchor.download = name; anchor.click();
  }}><File size={15} /><span>{name}</span><small>{loading ? "Loading…" : asset ? formatBytes(asset.bytes) : "Unavailable"}</small></button>;
}

function AssetLink({ asset, server, children }: { asset: PageAsset; server: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const source = fileSrc(qualify(asset.path, server));
  const image = asset.mimeType.startsWith("image/");
  const audio = asset.mimeType.startsWith("audio/");
  const video = asset.mimeType.startsWith("video/");
  const pdf = asset.mimeType === "application/pdf";
  const readable = asset.mimeType.startsWith("text/") || /(?:json|xml|javascript|yaml)/i.test(asset.mimeType);
  useEffect(() => {
    if (!open || !readable) return;
    let live = true;
    setText(null);
    if (asset.size > 2 * 1024 * 1024) { setText("This file is too large for a text preview. Download it to read it."); return; }
    void fetch(source).then((response) => { if (!response.ok) throw new Error("Could not load this file."); return response.text(); }).then((value) => { if (live) setText(value); }).catch(() => { if (live) setText("Preview unavailable. You can still download this file."); });
    return () => { live = false; };
  }, [open, readable, source, asset.size]);
  const download = async () => {
    setDownloading(true); setDownloadError(null);
    try {
      const response = await fetch(source);
      if (!response.ok) throw new Error("Could not download this file.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = asset.name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setDownloadError("Could not download this file. Try again."); }
    finally { setDownloading(false); }
  };
  return <><button type="button" className="spaces-preview-asset-link" onClick={() => setOpen(true)}><File size={15} /><span>{children || asset.name}</span></button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-5xl"><DialogHeader><DialogTitle>{asset.name}</DialogTitle><DialogDescription>{formatBytes(asset.size)} · {asset.mimeType}</DialogDescription></DialogHeader><div className="spaces-preview-media">{image ? <img src={source} alt={asset.name} /> : audio ? <audio controls src={source} preload="metadata" /> : video ? <video controls src={source} preload="metadata" playsInline /> : pdf ? <iframe src={source} title={asset.name} sandbox="" /> : readable ? <pre>{text ?? "Loading preview…"}</pre> : <p><FileText size={24} />Preview unavailable for this file type.</p>}</div><div className="flex items-center gap-3">{downloadError && <p role="alert" className="text-xs text-destructive">{downloadError}</p>}<Tooltip><TooltipTrigger asChild><Button className="ml-auto" variant="outline" onClick={() => void download()} disabled={downloading}>{downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}Download</Button></TooltipTrigger><TooltipContent>Download {asset.name}</TooltipContent></Tooltip></div></DialogContent></Dialog></>;
}

/// Only explicitly relative references follow the current Page's owner.
export function previewPageTarget(target: PageTarget, server: string): PageTarget {
  const { relative, ...absolute } = target;
  return relative === true ? { ...absolute, server } : absolute;
}

/// Page previews reuse Carbon's Markdown rendering stack with document-scoped media and rich plugins.
function PagePreview({ markdown, server, assets, onOpenPage }: Props) {
  const { pair, resolvedMode } = useCodeThemeWithMode();
  const [math, setMath] = useState<MathPlugin>();
  const [mermaid, setMermaid] = useState<DiagramPlugin>();
  const [pluginError, setPluginError] = useState(false);
  const hasMath = /\$[^\n$]+\$|\$\$/.test(markdown);
  const hasMermaid = /(?:^|\n)\s*`{3,}mermaid\b/.test(markdown);
  useEffect(() => {
    let live = true;
    if (hasMath) void loadMath().then((plugin) => { if (live) setMath(plugin); }).catch(() => { if (live) setPluginError(true); });
    if (hasMermaid) void loadMermaid().then((plugin) => { if (live) setMermaid(plugin); }).catch(() => { if (live) setPluginError(true); });
    return () => { live = false; };
  }, [hasMath, hasMermaid]);
  const code = useMemo(() => createSharedCodePlugin(pair), [pair]);
  const components = useMemo<Components>(() => ({
    table: MarkdownTable,
    img: ({ src, alt }) => {
      const original = typeof src === "string" ? decodeAssetUrl(src) : "";
      if (isLinearUpload(original) && server === LOCAL) return <IssueImage src={original} alt={alt} />;
      return <MediaImage src={original} alt={alt ?? ""} server={server} assets={assets} />;
    },
    a: ({ href, children, node: _node, ...rest }: ComponentProps<"a"> & { node?: unknown }) => {
      if (!href) return <span>{children}</span>;
      const target = parsePageUrl(href);
      if (target) return <button type="button" className="spaces-preview-page-link" onClick={() => onOpenPage?.(previewPageTarget(target, server))}><FileText size={13} />{children}</button>;
      const original = decodeAssetUrl(href);
      const asset = assets.find((item) => item.url === original);
      if (asset) return <AssetLink asset={asset} server={server}>{children}</AssetLink>;
      if (original.startsWith("carbon-asset:")) return <span className="spaces-preview-unavailable">{children} · Attachment unavailable</span>;
      if (isLinearUpload(original)) return server === LOCAL ? <IssueFile href={original} name={typeof children === "string" ? children : "Attachment"} /> : <RemoteIssueFile href={original} name={typeof children === "string" ? children : "Attachment"} server={server} />;
      return <a {...rest} href={href} onClick={(event) => { if (href.startsWith("#")) return; event.preventDefault(); openLink(href, event); }}>{children}</a>;
    },
  }), [assets, onOpenPage, server]);
  return <div className="spaces-page-preview">{pluginError && <p className="spaces-preview-unavailable" role="status">Some previews could not load. Their source is still shown below.</p>}<Streamdown mode="static" plugins={{ code, ...(hasMath && math ? { math } : {}), ...(hasMermaid && mermaid ? { mermaid } : {}) }} components={components} rehypePlugins={pagePreviewRehypePlugins} shikiTheme={[pair.light as ThemeInput, pair.dark as ThemeInput]} lineNumbers={false} controls={{ table: false, code: { copy: true, download: false }, mermaid: { copy: false, download: false, fullscreen: false } }} mermaid={{ config: { securityLevel: "strict", theme: resolvedMode === "dark" ? "dark" : "default", startOnLoad: false, suppressErrorRendering: true } }} className="spaces-preview-markdown">{markdown || "*This Page is empty.*"}</Streamdown></div>;
}

export default memo(PagePreview);
