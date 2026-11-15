import { Markdown } from "@/components/chat/Markdown";
import MessageActions from "@/components/chat/MessageActions";
import { useChatSession } from "@/hooks/useChatSession";
import { splitIssueProposal } from "@/lib/issueDraft";

/// Full-width and unbubbled — assistant output is the page's main content, and
/// wrapping code blocks or tables in a bubble only costs horizontal room.
export default function AssistantMessage({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  const { issueDrafting } = useChatSession();
  const content = issueDrafting ? splitIssueProposal(text, streaming).text : text;
  if (!content.trim()) return streaming && issueDrafting && text.includes("```carbon-issue")
    ? <p role="status" className="text-ui text-muted-foreground">Preparing issue review…</p> : null;
  return (
    <div className="group/message flex min-w-0 flex-col gap-1.5">
      <Markdown streaming={streaming} linkFilePaths>
        {content}
      </Markdown>
      {!streaming && content.trim() && (
        <MessageActions text={content} copyLabel="Copy response" tooltipAlign="start" />
      )}
    </div>
  );
}
