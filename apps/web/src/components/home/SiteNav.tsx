import Link from "next/link";
import { DownloadButton } from "@/components/DownloadButton";
import { GitHubGlyph } from "@/components/GitHubGlyph";
import { Wordmark } from "@/components/Wordmark";
import { fetchStars, formatStars } from "@/lib/github";
import { REPO } from "@/lib/links";
import { SiteLinks } from "./SiteLinks";
import { MobileNav } from "./MobileNav";
import mobile from "./mobile-nav.module.css";
import { SchemeToggle } from "./SchemeToggle";
import styles from "./hero.module.css";

const secondary = `${styles.action} ${styles.secondaryAction}`;

export async function SiteNav({ bare = false }: { bare?: boolean } = {}) {
  const stars = await fetchStars();

  return (
    <nav data-page-part="nav" aria-label="Main" className={styles.navbar}>
      <Link href="/" aria-label="Carbon home" className={`flex h-10 w-[120px] min-w-0 items-center justify-center px-2 ${bare ? "" : "bg-black light:bg-white"}`}>
        <Wordmark className="h-auto w-full text-white light:text-[#0A0A0A]" />
      </Link>
      <div className={`${styles.navLinks} ${mobile.desktop}`}><SiteLinks /></div>
      <div className={`${styles.navActions} ${styles.compactActions} ${mobile.desktop}`}>
        <SchemeToggle className={styles.themeButton} />
        <a
          href={REPO}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Carbon on GitHub, ${formatStars(stars)} stars`}
          className={`${secondary} inline-flex`}
        >
          <GitHubGlyph className="size-4" />
          {formatStars(stars)}
        </a>
        <DownloadButton
          from="nav"
          label="Download"
          className={`${styles.action} ${styles.primaryAction} inline-flex`}
        />
      </div>
      <MobileNav />
    </nav>
  );
}
