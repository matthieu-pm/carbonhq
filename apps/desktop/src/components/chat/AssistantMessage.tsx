import { Markdown } from "@/components/chat/Markdown";
import MessageActions from "@/components/chat/MessageActions";

/// Full-width and unbubbled — assistant output is the page's main content, and
/// wrapping code blocks or tables in a bubble only costs horizontal room.
export default function AssistantMessage({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    <div className="group/message flex min-w-0 flex-col gap-1.5">
      <Markdown streaming={streaming} linkFilePaths>
        {text}
      </Markdown>
      {!streaming && text.trim() && (
        <MessageActions text={text} copyLabel="Copy response" tooltipAlign="start" />
      )}
    </div>
  );
}
