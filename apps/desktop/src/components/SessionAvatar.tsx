import BotAvatar from "@/components/BotAvatar";

/// Session references share the crew's character even after the session is retitled.
export default function SessionAvatar({ sessionId, className }: {
  sessionId: string;
  name: string;
  className?: string;
}) {
  return <BotAvatar seed={sessionId} className={className} />;
}
