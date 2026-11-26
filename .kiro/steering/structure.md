---
inclusion: always
---

# Necropolis — Structure and Conventions

## Folder layout

```
necropolis/
├─ app/              # Next.js App Router — pages and layouts
├─ components/       # React UI components (not scene)
├─ scene/            # PixiJS graveyard: canvas, entities, rendering
├─ scanner/          # Pure detector functions, one file per entity type
│  ├─ tombstone.ts   # Dead code detector
│  ├─ ghost.ts       # Stale file detector
│  ├─ crypt.ts       # Large/complex file detector
│  └─ wraith.ts      # Orphaned dependency detector
├─ lib/
│  └─ github/        # GitHub REST API client and fetch logic
├─ tests/            # Vitest unit and property-based tests
└─ docs/             # Design docs, architecture decisions
```

## Naming conventions

- **Components** use PascalCase: `GraveyardCanvas.tsx`, `EntityPanel.tsx`.
- **Utility modules** and **scanner files** use kebab-case: `tombstone.ts`, `fetch-repo.ts`.
- **Types** are co-located with the code that uses them. If a type is shared across multiple modules, it lives in a `types.ts` file at the nearest common parent.

## Where new detectors go

Every new entity type or signal needs:

1. A **detector function** in `scanner/<entity>.ts` — pure, exported as a named function, documented with a TSDoc comment explaining the signal.
2. A **property-based test** in `tests/scanner/<entity>.test.ts` using fast-check.
3. A **rendering implementation** in `scene/` that knows how to draw the entity on the canvas.
4. An **entity case** in the detail panel component (`components/EntityPanel.tsx`) that knows how to display findings and remediation.

If you're adding a new detector, follow the existing files (`tombstone.ts`, `ghost.ts`, etc.) as templates. All four pieces must ship together — a signal without a detector is invisible; a detector without a renderer is unfixable.

## Barrel exports and paths

- Use barrel exports (`index.ts`) sparingly. Only export from a folder when the public API is stable and narrow.
- Prefer absolute imports from the workspace root (`@/scanner/tombstone`) over relative imports that traverse parent directories (`../../scanner/tombstone`).
- Path aliases are configured in `tsconfig.json` and must match Vitest's config (`vitest.config.ts`).

## Comments and documentation

- Functions exposed to other modules must have a TSDoc comment.
- Internal helpers and inline logic need comments only when the code's intent is not immediately clear from its structure and naming.
- Every detector function's TSDoc should state: what signal it detects, what threshold or heuristic it uses, and what it returns.
