import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import PageDocument from "./PageDocument";
import PageSnapshot from "./PageSnapshot";
import { openPageDraft } from "@/hooks/usePageDocument";
import { readPage, type LocatedPage, type Page, type PageTarget } from "@/lib/pages";
import type { TabPage } from "@/lib/spaceTabs";
import type { Project } from "@/types/events";

const DeckDocument = lazy(() => import("./DeckDocument"));

/// One Page tab: reads its document on first mount and keeps the editor
/// mounted while hidden, so switching tabs keeps each one's place. Keyed by the
/// Page it shows, so pointing the tab elsewhere starts it over.
export default function PageTabBody({ page: target, shown, active, projects, visibleProjects, onTitle, onFlushReady, onTrashed, onHidden, onOpenCurrent }: {
  page: TabPage;
  shown: boolean;
  active: boolean;
  projects: Project[];
  visibleProjects: string[] | null;
  onTitle: (title: string, format?: Page["format"]) => void;
  onFlushReady: (flush: () => void) => void;
  onTrashed: () => void;
  /// The document belongs only to projects the current Profile hides.
  onHidden: () => void;
  onOpenCurrent: (target: PageTarget, title: string) => void;
}) {
  const [document, setDocument] = useState<LocatedPage<Page> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const callbacks = useRef({ onTitle, onHidden });
  callbacks.current = { onTitle, onHidden };

  useEffect(() => {
    let stopped = false;
    setError(null);
    readPage(target, target.revision).then((read) => {
      if (stopped) return;
      if (target.revision === undefined) openPageDraft(read);
      setDocument(read);
      callbacks.current.onTitle(read.title, read.format);
    }, (reason) => { if (!stopped) setError(String(reason)); });
    return () => { stopped = true; };
  // The body is keyed by the Page, so only a retry reads again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useLayoutEffect(() => {
    if (!document || visibleProjects === null || document.projectPaths.length === 0) return;
    if (!document.projectPaths.some((path) => visibleProjects.includes(path))) callbacks.current.onHidden();
  // Drafts live outside navigation, so a Profile change hides content without losing edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleProjects?.join("\n"), document?.projectPaths.join("\n")]);

  if (error) return <div role="alert" className="spaces-error mt-6">{error}<button onClick={() => setAttempt((n) => n + 1)}>Retry</button></div>;
  if (!document) return <div className="spaces-empty"><Loader2 className="size-5 animate-spin" /><p>Opening Page…</p></div>;
  if (document.format === "opf") {
    return <Suspense fallback={<div className="spaces-empty">Opening slide deck…</div>}>
      <DeckDocument page={document} active={active && shown} snapshot={target.revision !== undefined}
        onTitle={onTitle} onFlushReady={onFlushReady}
        onOpenCurrent={() => onOpenCurrent({ id: document.id, server: document.server }, document.title)} />
    </Suspense>;
  }
  if (target.revision !== undefined) {
    return <PageSnapshot page={document} onOpenCurrent={() => onOpenCurrent({ id: document.id, server: document.server }, document.title)} />;
  }
  return <PageDocument page={document} active={active && shown} projects={projects} visibleProjects={visibleProjects}
    onFlushReady={onFlushReady}
    onSaved={(saved) => { setDocument(saved); onTitle(saved.title); }}
    onTrashed={onTrashed} />;
}
