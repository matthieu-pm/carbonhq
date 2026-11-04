import {
  siAirtable,
  siAsana,
  siAtlassian,
  siAuth0,
  siBrave,
  siClerk,
  siClickup,
  siCloudflare,
  siConfluence,
  siContentful,
  siConvex,
  siDatabricks,
  siDatadog,
  siDiscord,
  siDocker,
  siDropbox,
  siElevenlabs,
  siExcalidraw,
  siFigma,
  siFirebase,
  siFramer,
  siGithub,
  siGitlab,
  siGmail,
  siGooglecalendar,
  siGooglechrome,
  siGooglecolab,
  siGoogledrive,
  siGrafana,
  siHubspot,
  siHuggingface,
  siIntercom,
  siJira,
  siKubernetes,
  siLinear,
  siMiro,
  siMixpanel,
  siMongodb,
  siMysql,
  siNeon,
  siNetlify,
  siNewrelic,
  siNotion,
  siObsidian,
  siPaypal,
  siPerplexity,
  siPosthog,
  siPostgresql,
  siPrisma,
  siPuppeteer,
  siRailway,
  siRaycast,
  siRedis,
  siRender,
  siReplicate,
  siResend,
  siSanity,
  siSentry,
  siShopify,
  siSnowflake,
  siSqlite,
  siStripe,
  siSupabase,
  siTerraform,
  siTodoist,
  siTrello,
  siUpstash,
  siVercel,
  siWebflow,
  siWordpress,
  siXcode,
  siYoutube,
  siZapier,
  siZendesk,
  type SimpleIcon,
} from "simple-icons";

import { Globe2Outline12, SlackGlyph32, TerminalOutline18 } from "@/components/icons/nucleo";
import { cn } from "@/lib/utils";
import type { McpServerEntry } from "@/types/events";

/// Which brand a server is, by a word in its name, URL host or command.
///
/// Matched on whole words, so `box` does not light up on `sandbox`; a key of
/// six letters or more may also sit inside a longer word (`supabase-mcp`,
/// `server-postgres`), where a false hit is unlikely.
const BRANDS: [string[], SimpleIcon][] = [
  [["linear"], siLinear],
  [["github"], siGithub],
  [["gitlab"], siGitlab],
  [["figma"], siFigma],
  [["notion"], siNotion],
  [["sentry"], siSentry],
  [["vercel"], siVercel],
  [["supabase"], siSupabase],
  [["stripe"], siStripe],
  [["cloudflare"], siCloudflare],
  [["atlassian"], siAtlassian],
  [["jira"], siJira],
  [["confluence"], siConfluence],
  [["postgres", "postgresql"], siPostgresql],
  [["docker"], siDocker],
  [["gdrive", "googledrive"], siGoogledrive],
  [["airtable"], siAirtable],
  [["asana"], siAsana],
  [["hubspot"], siHubspot],
  [["zapier"], siZapier],
  [["obsidian", "mcpvault"], siObsidian],
  [["colab"], siGooglecolab],
  [["excalidraw"], siExcalidraw],
  [["neon"], siNeon],
  [["mongodb", "mongo"], siMongodb],
  [["redis"], siRedis],
  [["puppeteer"], siPuppeteer],
  [["brave"], siBrave],
  [["perplexity"], siPerplexity],
  [["chrome", "devtools"], siGooglechrome],
  [["sqlite"], siSqlite],
  [["mysql"], siMysql],
  [["paypal"], siPaypal],
  [["shopify"], siShopify],
  [["discord"], siDiscord],
  [["trello"], siTrello],
  [["miro"], siMiro],
  [["gmail"], siGmail],
  [["gcal", "calendar"], siGooglecalendar],
  [["todoist"], siTodoist],
  [["clickup"], siClickup],
  [["intercom"], siIntercom],
  [["zendesk"], siZendesk],
  [["datadog"], siDatadog],
  [["grafana"], siGrafana],
  [["newrelic"], siNewrelic],
  [["posthog"], siPosthog],
  [["mixpanel"], siMixpanel],
  [["snowflake"], siSnowflake],
  [["databricks"], siDatabricks],
  [["firebase"], siFirebase],
  [["netlify"], siNetlify],
  [["render"], siRender],
  [["railway"], siRailway],
  [["dropbox"], siDropbox],
  [["youtube"], siYoutube],
  [["huggingface", "hf"], siHuggingface],
  [["replicate"], siReplicate],
  [["terraform"], siTerraform],
  [["kubernetes", "k8s", "kubectl"], siKubernetes],
  [["upstash"], siUpstash],
  [["prisma"], siPrisma],
  [["convex"], siConvex],
  [["clerk"], siClerk],
  [["auth0"], siAuth0],
  [["resend"], siResend],
  [["elevenlabs"], siElevenlabs],
  [["xcode"], siXcode],
  [["raycast"], siRaycast],
  [["webflow"], siWebflow],
  [["framer"], siFramer],
  [["sanity"], siSanity],
  [["contentful"], siContentful],
  [["wordpress"], siWordpress],
];

/// Every word a server says about itself: its name, its URL's host and its
/// command line. Paths are reduced to their last segment, or a server run out
/// of `~/neon/bin` would read as Neon.
function wordsOf(server: McpServerEntry): { words: Set<string>; text: string } {
  let host = "";
  try {
    if (server.url) host = new URL(server.url).hostname;
  } catch {
    // An unparseable URL is drawn as written; it just names no brand.
  }
  const command = [server.command ?? "", ...server.args]
    .map((part) => part.split("/").pop() ?? "")
    .join(" ");
  const text = `${server.name} ${host} ${command}`.toLowerCase();
  return { words: new Set(text.split(/[^a-z0-9]+/).filter(Boolean)), text };
}

/// The brand behind a server, where one is recognisable.
export function brandOf(server: McpServerEntry): SimpleIcon | "slack" | null {
  const { words, text } = wordsOf(server);
  if (words.has("slack")) return "slack";
  for (const [keys, icon] of BRANDS) {
    if (keys.some((key) => words.has(key) || (key.length >= 6 && text.includes(key)))) return icon;
  }
  return null;
}

/// A server's mark: the brand's own logo where the server is a known product,
/// otherwise a terminal for a local process and a globe for a URL.
///
/// On `currentColor`, for `AgentIcon`'s reason — a column of brand colours is
/// the loudest thing on a page whose job is to be read.
export default function McpLogo({ server, className }: { server: McpServerEntry; className?: string }) {
  const brand = brandOf(server);
  const cls = cn("size-4 shrink-0", className);
  if (brand === "slack") return <SlackGlyph32 className={cls} aria-hidden />;
  if (brand) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={cls} role="img" aria-label={brand.title}>
        <path d={brand.path} />
      </svg>
    );
  }
  return server.transport === "stdio" ? (
    <TerminalOutline18 className={cls} aria-hidden />
  ) : (
    <Globe2Outline12 className={cls} aria-hidden />
  );
}
