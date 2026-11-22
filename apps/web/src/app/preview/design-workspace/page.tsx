import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Design workspace previews - Carbon",
  robots: { index: false },
};

const sets = [
  {
    name: "Opus I",
    previews: [
      ["canvas", "Canvas", "Select a layer and watch its radius and fill change in the inspector."],
      ["studio", "Studio", "Edit an accent token and see every linked layer pick up the new color."],
      ["fieldnotes", "Fieldnotes", "Follow a pinned comment and its canvas snapshot into the agent conversation."],
    ],
  },
  {
    name: "Opus II",
    previews: [
      ["opus-b/studio", "Studio", "Adjust a button’s corners, bind its fill to a token, then try the inspector yourself."],
      ["opus-b/canvas", "Canvas", "Circle a detail with the pen and send your own annotated snapshot to canvas chat."],
      ["opus-b/fieldnotes", "Fieldnotes", "Change the brand color and corner radius to restyle a welcome screen."],
    ],
  },
];

export default function DesignWorkspacePreviews() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16 sm:px-10">
      <Link href="/design-workspace" className="text-sm text-muted-foreground hover:underline">← Design workspace</Link>
      <h1 className="mt-6 mb-12 text-4xl font-medium tracking-tight">Design workspace previews</h1>
      {sets.map(({ name, previews }) => (
        <section key={name} className="mb-12">
          <h2 className="mb-5 text-sm font-medium text-muted-foreground">{name}</h2>
          <ul className="grid gap-8 sm:grid-cols-3">
            {previews.map(([slug, title, summary]) => (
              <li key={slug}>
                <Link href={`/design-workspace/${slug}`} className="group block rounded-md focus-visible:outline-offset-4">
                  <h3 className="text-xl font-medium group-hover:underline">{title} <span aria-hidden="true">↗</span></h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{summary}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
