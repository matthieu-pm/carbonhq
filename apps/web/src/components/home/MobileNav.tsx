"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DownloadButton } from "@/components/DownloadButton";
import { GitHubGlyph } from "@/components/GitHubGlyph";
import { Wordmark } from "@/components/Wordmark";
import { REPO } from "@/lib/links";
import { SiteLinks } from "./SiteLinks";
import { SchemeToggle } from "./SchemeToggle";
import buttons from "./hero.module.css";
import styles from "./mobile-nav.module.css";

function MenuIcon() {
  return <span className={styles.icon} aria-hidden="true"><i /><i /><i /></span>;
}

export function MobileNav() {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const desktop = matchMedia("(min-width: 640px)");
    const closeOnDesktop = () => { if (desktop.matches) dialog.current?.close(); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <div className={styles.mobile}>
      <button
        type="button" aria-label="Open menu" aria-expanded={open} aria-haspopup="dialog" aria-controls={id}
        className={styles.toggle}
        onClick={(event) => {
          const panel = dialog.current!;
          const nav = event.currentTarget.closest("nav")!.getBoundingClientRect();
          panel.style.setProperty("--nav-top", `${Math.max(0, nav.top)}px`);
          panel.style.setProperty("--nav-start", `${nav.left}px`);
          panel.style.setProperty("--nav-end", `${document.documentElement.clientWidth - nav.right}px`);
          panel.showModal();
          setOpen(true);
        }}
      >
        <MenuIcon />
      </button>
      <dialog
        id={id} ref={dialog} aria-label="Site menu" className={styles.panel}
        onClose={() => setOpen(false)}
        onClick={(event) => { if ((event.target as Element).closest("a")) dialog.current?.close(); }}
      >
        <div className={styles.layout}>
          <div className={styles.header}>
            <a href="/" aria-label="Carbon home" className="flex h-10 w-[120px] items-center px-2">
              <Wordmark className="w-full" />
            </a>
            <SchemeToggle className={styles.theme} />
            <button autoFocus type="button" aria-label="Close menu" className={styles.toggle} onClick={() => dialog.current?.close()}>
              <MenuIcon />
            </button>
          </div>
          <div className={styles.links}>
            <SiteLinks />
          </div>
          <div className={`${buttons.navActions} ${styles.actions}`}>
            <a href={REPO} target="_blank" rel="noopener noreferrer" className={`${buttons.action} ${buttons.secondaryAction} flex`}>
              <GitHubGlyph className="size-4" /> View on GitHub
            </a>
            <DownloadButton from="nav" className={`${buttons.action} ${buttons.primaryAction} flex`} />
          </div>
        </div>
      </dialog>
    </div>
  );
}
