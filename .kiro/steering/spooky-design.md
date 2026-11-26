---
inclusion: always
---

# Necropolis — Visual and Voice System

## Color palette

| Role | Usage |
|---|---|
| **Near-black** `#0d0f12` | Primary background. The void the graveyard sits in. |
| **Fog gray** `#1e2229` | Secondary surfaces: panels, cards, overlays. |
| **Moonlight blue** `#7ba7c2` | Primary accent. Active selections, headings, interactive elements. |
| **Lantern amber** `#c97c2e` | Secondary accent. Hover states, warm highlights, the "Exorcise" action. |
| **Sickly green** `#5aad5a` | Danger / high-severity debt only. Use it once; it should feel wrong. |
| **Muted text** `#8a9099` | Secondary text, timestamps, metadata. Never for primary labels. |

Do not introduce new colors outside this palette. If a need can't be met by a tint or opacity variant of an existing color, raise it for review.

## Typography

- **Gothic display font** (e.g. Cinzel, UnifrakturMaguntia) — headings, entity names, section titles. Evocative. Never used for body copy or data.
- **Clean readable font** (e.g. Inter, Geist) — all body text, labels, file paths, code, metadata. Legibility is non-negotiable here.

Heading hierarchy: `h1` for page-level titles, `h2` for panel titles, `h3` for section labels within a panel. No skipping levels.

## Motion

All animation uses Framer Motion.

- **Fog**: slow, horizontal drift across the lower third of the canvas. Loop duration 20–40 seconds. Opacity 0.15–0.35.
- **Lantern flicker**: subtle, irregular opacity pulse on lamp sprites. Never distracting. Keyframes should feel imperfect, not mechanical.
- **Tombstone reveal**: entities fade and rise slightly into view when the graveyard first populates (stagger by 80–120 ms per entity).
- **Panel slide**: the detail panel slides in from the right on entity click (200 ms ease-out). It slides out on dismiss.
- **Banish/Exorcise**: the entity flickers, then dissolves with a brief particle scatter before fading out. Satisfying, not flashy.

Motion should feel slow and atmospheric, not snappy or modern. If an animation could belong in a fintech dashboard, it doesn't belong here.

## Copy voice

Write copy as if a dry, knowing Victorian undertaker is narrating a codebase obituary. Darkly witty, never try-hard. The humor comes from treating mundane tech debt with funeral gravitas — not from pop-culture references or forced puns.

**Tombstone epitaphs follow this pattern:**

> "Here lies `utils/legacy.ts` — untouched since 2023, imported by no one."

The pattern is: file or symbol name, then the exact signal that condemns it, stated plainly. The wit is in the framing, not in obscuring the actual problem. The developer must be able to read the epitaph and immediately know what's wrong.

**Other copy principles:**

- Remediation instructions are plain and direct. No gothic framing for `git rm` commands.
- Error states use the same voice at reduced intensity — something went wrong, here's what, here's what to try.
- Empty states (no debt found) should feel like a small, disbelieving victory: "The graveyard is quiet. For now."
- Avoid exclamation marks in flavor copy. The horror is in the understatement.

## Accessibility

- **WCAG AA contrast** for all text against its background. Measure every color combination before shipping. Moonlight blue on near-black must pass; adjust lightness if it doesn't.
- **Reduced-motion mode**: when `prefers-reduced-motion: reduce` is set, all Framer Motion animations are disabled or replaced with instant cuts. The scene is still fully usable. Use Framer Motion's `useReducedMotion()` hook and test it.
- **Sound**: if any audio is added, it must be off by default with a clearly labeled toggle. No auto-play under any circumstances.
- **Focus management**: keyboard navigation must reach every interactive element. The detail panel must trap focus while open and return it to the triggering entity on close.
- **Semantic HTML**: use appropriate landmark elements (`main`, `nav`, `aside`, `section`) and ARIA roles where native semantics fall short. The canvas entity is not keyboard-navigable by default — provide a parallel list view or screen-reader-accessible representation.
