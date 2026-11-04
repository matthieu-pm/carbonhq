---
name: great-ui
description: Faithful single-skill merge of Jakub Krehel's better-ui and Emil Kowalski's emil-design-eng. Use to build, polish, animate, or review interfaces with the complete source guidance on surfaces, optical alignment, icons, interaction motion, gestures, animation performance, accessibility, component craft, perceived speed, and UI review.
---

# Great UI

This package unifies the complete `better-ui` and `emil-design-eng` skills. Their instructions are preserved verbatim in the references; this entrypoint only routes between them and resolves overlaps. Do not substitute a summary for the source material.

## Required reading

For every invocation, read both source entrypoints completely before acting:

1. [better-ui/SKILL.md](references/better-ui/SKILL.md)
2. [emil-design-eng/SKILL.md](references/emil-design-eng/SKILL.md)

Then read every detailed `better-ui` guide relevant to the task:

- [surfaces.md](references/better-ui/surfaces.md) for concentric radii, optical alignment, layered shadows, borders, and image outlines.
- [animations.md](references/better-ui/animations.md) for interruptible transitions, press feedback, initial render, theme switching, and motion restraint.
- [enter-exit.md](references/better-ui/enter-exit.md) for staged entrances, stagger, and quieter exits.
- [icon-transitions.md](references/better-ui/icon-transitions.md) for exact Motion and CSS icon-swap recipes.
- [icons.md](references/better-ui/icons.md) for weight, state, render size, SVG treatment, and RTL.
- [performance.md](references/better-ui/performance.md) for exact transition properties and disciplined `will-change`.

For a comprehensive implementation, redesign, or audit, read all six guides. The full Emil source is a single entrypoint and therefore must always be read in full.

## Combining the sources

Apply both sources together. Keep the project's component library, tokens, density, and established motion language unless the user asks to change them or a source specifies an exact interaction.

When instructions overlap, use the narrower contextual rule:

| Topic | Combined rule |
| --- | --- |
| Button press | Use `scale(0.96)` and `150ms ease-out` as the exact general recipe from `better-ui`. Emil's `0.95–0.98` range explains the acceptable family, not a reason to alter that default. Allow a static escape hatch. |
| Contextual icon swap | Use the exact `0.25 → 1` scale, `0 → 1` opacity, `4px → 0` blur, and `duration: 0.3, bounce: 0` recipe. This is separate from Emil's rule never to use `scale(0)` for ordinary element entrances. |
| Spring bounce | Contextual icon swaps always use `bounce: 0`. General gestures or deliberately playful decorative motion may use Emil's subtle `0.1–0.3` bounce. Most product UI remains at zero. |
| Stagger | Use roughly `100ms` between large semantic groups such as title, description, and actions. Use `30–80ms` between smaller repeated items. Never stagger high-frequency interactions or block input. |
| Translation distance | Use a small fixed offset for subtle entrances and exits. Use percentage translation when an element must move by its own full size to preserve spatial context, such as a drawer or toast. |
| Duration | Keep routine UI under `300ms`. A modal or drawer may extend toward Emil's `500ms` ceiling only when travel distance and product character justify it. Exits are normally shorter than entrances. |
| Animated properties | Prefer `transform` and `opacity`. Use `filter` or `clip-path` only for the specific source recipes and verify performance, especially in Safari. |
| CSS vs JavaScript | Use CSS for predetermined motion and transitions for interruptible state changes. Use springs or JavaScript for dynamic gestures, velocity, and orchestration. Measure rather than assuming a library is accelerated. |
| First render | Disable initial presence animation for components that should begin settled. Preserve intentional first-time hero, onboarding, loading, or explanatory entrances. |
| Accessibility | Reduced motion removes movement and position animation while retaining brief opacity or color feedback that aids comprehension. Motion is never the only state cue. |

## Working method

Before implementing animation, answer Emil's four questions in order: should it animate, what purpose does it serve, which easing fits, and how fast should it be. Then apply the exact `better-ui` recipe when the interaction matches one.

Polish is cumulative. Inspect optical alignment, nested radii, elevation, icon weight, icon state, initial render, interruption, pointer behavior, reduced motion, theme switching, and compositing. Review motion at normal speed and at 10% speed or frame by frame. Test gesture behavior on real hardware when it matters.

Good defaults and invisible edge-case handling are part of component quality. Preserve focus, keyboard behavior, pointer capture, multi-touch protection, hidden-tab behavior, and static state communication while refining the visual experience.

## Review output

When reviewing, use the combined source format: group findings by violated principle, order them by severity, and use one Markdown table.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |

`HIGH` breaks an interaction, makes motion unusable, or makes state depend only on animation. `MEDIUM` is a visible inconsistency in surfaces, icons, or motion. `LOW` is isolated polish.

End with verification and every unverified state. Use `Block` when any `HIGH` remains and `Approve` otherwise. Never approve coverage that was not inspected. With no findings, state `No actionable UI-polish findings`.
