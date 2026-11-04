# Great UI

[![skills.sh](https://skills.sh/b/matthieu-pm/great-ui)](https://skills.sh/matthieu-pm/great-ui/great-ui)

A single agent skill for building and polishing interfaces where every small detail compounds.

Great UI faithfully combines:

- [Jakub Krehel's `better-ui`](https://github.com/jakubkrehel/skills/tree/main/skills/better-ui), with exact recipes for surfaces, optical alignment, contextual icons, and performant motion.
- [Emil Kowalski's `emil-design-eng`](https://github.com/emilkowalski/skills/tree/main/skills/emil-design-eng), with design-engineering judgment for interaction purpose, animation, gestures, accessibility, and component craft.

The source skills remain intact under [`references/`](references/). The top-level [`SKILL.md`](SKILL.md) routes between them and resolves their overlapping guidance.

## Install

Install with the Skills CLI:

```bash
npx skills add matthieu-pm/great-ui
```

Or target Great UI explicitly:

```bash
npx skills add https://github.com/matthieu-pm/great-ui --skill great-ui
```

Install globally for Codex:

```bash
npx skills add https://github.com/matthieu-pm/great-ui --skill great-ui --agent codex -g -y
```

## Use

```text
/great-ui Build this interaction with considered defaults and accessible state feedback.

/great-ui Polish this page without changing its product or visual language.

/great-ui Review every surface, icon, and motion state. Report what still feels off.
```

## What it covers

- Concentric radii, optical alignment, layered surfaces, shadows, and image outlines
- Icon sizing, weight, state, rendering, RTL behavior, and contextual transitions
- Animation decisions, easing, duration, interruption, entrance and exit choreography
- Gesture behavior, pointer capture, momentum, damping, and multi-touch protection
- Perceived performance, compositing, reduced motion, and interaction accessibility
- Component defaults, edge-case handling, UI review, and craft judgment

## Attribution

This repository preserves substantial portions of two MIT-licensed source skills. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for pinned source revisions, copyright notices, and license text.

## License

[MIT](LICENSE)
