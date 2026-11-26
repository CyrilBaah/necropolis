---
inclusion: always
---

# Necropolis — Product

## What it is

Necropolis is a tech-debt visualizer that presents a GitHub repository as a 2D graveyard. Each piece of technical debt becomes a tombstone, gravestone, or spectral entity in the scene. Developers and maintainers use it to quickly see where the bodies are buried — dead code, forgotten files, stale dependencies, and long-untouched modules — and then act on what they find.

## Who it's for

- **Developers** who want an honest, at-a-glance picture of where debt has accumulated in a codebase.
- **Maintainers and tech leads** who need to prioritize cleanup work and convince others the problem is real.

The audience understands code. They don't need debt explained to them; they need it surfaced clearly and made easy to act on.

## The four entity types

Each entity type maps one-to-one to a detectable signal in the repository.

| Entity | Signal |
|---|---|
| **Tombstone** | Dead code — exported symbols that are never imported anywhere in the repo. |
| **Ghost** | Stale files — files that have not been touched in a configurable threshold (default: 6 months). |
| **Crypt** | Large, complex files — files above a size or cyclomatic-complexity threshold that are strong refactor candidates. |
| **Wraith** | Orphaned dependencies — packages listed in `package.json` that are not referenced in any source file. |

The scene populates one entity per detected item. The more debt, the fuller — and more unsettling — the graveyard.

## The Exorcise flow

When a user clicks an entity in the scene, a panel opens showing:

1. The specific file, symbol, or package the entity represents.
2. Why it was flagged (the exact signal: last-commit date, import count, file size, etc.).
3. A concrete, copy-pasteable remediation action — the shell command or code change needed to remove the debt.

Clicking **Exorcise** copies the remediation to the clipboard and marks the entity as "banished" in the UI (it fades out). The graveyard lightens as debt is acknowledged.

## Out of scope for the hackathon

- Persistence: no database, no user accounts, no saved state between sessions.
- Writing changes back to the repository (read-only throughout).
- Support for languages other than JavaScript and TypeScript.
- Monorepo traversal across multiple `package.json` files.
- CI/CD integration or webhook triggers.
- Paid tiers, rate-limit handling beyond the demo cache, or any billing logic.
