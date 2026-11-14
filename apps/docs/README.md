# Docs app

Blume builds the public documentation from [`content/`](content). Read
[STYLE.md](STYLE.md) before editing. Verify feature claims against current
source; a plan or demo alone does not establish availability.

## Develop and build

Use Node 22.19 or newer and the pnpm version in the root `package.json`.
Install once at the workspace root:

```bash
pnpm install --frozen-lockfile
```

Run these commands from `apps/docs`:

```bash
pnpm dev
pnpm build
```

The dev site is normally `http://localhost:4321/docs`. The build writes
`dist/`. Use `carbon browser open` and `carbon browser snapshot` to check
the routes you changed, including navigation and local links.

## The `/docs` rewrite

[`blume.config.ts`](blume.config.ts) sets `content.root` to `content` and
`deployment.base` to `/docs`. Generated links include `/docs`, but production
files are written at the output root. Keep content in `content`, or a nested
`docs` directory adds another `/docs` segment to its routes.

The marketing site's [`next.config.ts`](../web/next.config.ts) rewrites
`/docs` and `/docs/:path*` to `DOCS_ORIGIN`. In production, that variable names
the docs deployment origin without `/docs` or a trailing slash. The rewrite
strips the public prefix before forwarding. In development the default is
`http://localhost:4321/docs`, because Blume's dev server serves under the base.

To test the whole route locally, run this app and the marketing site's
`pnpm dev` in separate terminals, then open `http://localhost:3000/docs`.
The exact `/docs` rewrite has no trailing slash: adding one can loop through
Blume's redirect back to `/docs`.

## Analytics and publication

`NEXT_PUBLIC_POSTHOG_KEY` enables the analytics adapters at build time.
Without it, no analytics adapter loads. The configured `/ingest` endpoint is
the marketing site's proxy; a standalone dev server does not provide it.

This app has its own Vercel project. A local build verifies output; publication
and the marketing site's `DOCS_ORIGIN` are separate deployment steps. Keep
deployment changes outside a documentation-only edit unless requested.
