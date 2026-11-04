import { useCallback, useEffect, useRef, useState } from "react";

/// A copy button's confirmation: what went onto the clipboard, held for `ms`
/// and then dropped. `mark` is what `copied` holds meanwhile, the text itself
/// by default — so a control reused across sessions asks whether *its* text is
/// the copied one, and a stale flag cannot claim the next session's.
///
/// A failed write is logged and raises `failed` for the same `ms`. Most buttons
/// have nowhere to put an error and ignore it, so no check mark is their answer;
/// one with a tooltip can say so.
export function useCopied<T = string>(ms = 1600) {
  const [copied, setCopied] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text: string, mark?: T): Promise<boolean> => {
      clearTimeout(timer.current);
      try {
        await navigator.clipboard.writeText(text);
      } catch (err) {
        console.error("failed to copy", err);
        setCopied(null);
        setFailed(true);
        timer.current = setTimeout(() => setFailed(false), ms);
        return false;
      }
      setFailed(false);
      setCopied(() => mark ?? (text as T));
      timer.current = setTimeout(() => setCopied(null), ms);
      return true;
    },
    [ms],
  );

  return [copied, copy, failed] as const;
}
