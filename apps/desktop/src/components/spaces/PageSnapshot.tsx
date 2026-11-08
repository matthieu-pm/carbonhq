import { useEffect, useState } from "react";
import { ArrowUpRight, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invoke } from "@/lib/transport";
import { openPage, type LocatedPage, type Page, type PageAsset } from "@/lib/pages";
import PagePreview from "./PagePreview";

/// A conversation reference shows its cited content without opening an editor on an old base.
export default function PageSnapshot({ page, onOpenCurrent }: { page: LocatedPage<Page>; onOpenCurrent: () => void }) {
  const [assets, setAssets] = useState<PageAsset[]>([]);
  useEffect(() => {
    let stopped = false;
    void invoke<PageAsset[]>("list_page_assets", { id: page.id }, page.server).then((list) => { if (!stopped) setAssets(list); }, () => {});
    return () => { stopped = true; };
  }, [page.id, page.server]);
  return <div className="spaces-document"><div className="spaces-document-tools"><span className="text-xs text-muted-foreground">Revision {page.revision} cited in a conversation</span><Button size="sm" variant="outline" className="ml-auto" onClick={onOpenCurrent}>Open current Page<ArrowUpRight /></Button></div><div className="spaces-document-scroll"><article className="spaces-document-content"><FileText className="mb-5 size-9 text-muted-foreground/60" /><h1 className="spaces-document-title mb-8">{page.title}</h1><PagePreview markdown={page.markdown} server={page.server} assets={assets} onOpenPage={openPage} /></article></div></div>;
}
