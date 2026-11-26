---
inclusion: always
---

# Necropolis — Tech Stack

## Framework and language

- **Next.js (App Router)** — all routes use the `app/` directory. Server Components for data fetching; Client Components only where interactivity or browser APIs are required.
- **TypeScript strict mode** — `"strict": true` in `tsconfig.json`. No `any`, no type assertions without a comment explaining why.

## Styling and motion

- **Tailwind CSS** — utility-first. Custom design tokens (colors, fonts, spacing) are defined in `tailwind.config.ts`, not inline.
- **Framer Motion** — all animated transitions. Use it for fog drifting, lantern flicker, tombstone reveal, and panel slides. Never reach for CSS `@keyframes` for anything Framer Motion can express.

## Graveyard scene

- **PixiJS** — the 2D graveyard canvas lives entirely in `scene/`. It is a Client Component that owns the canvas element. No PixiJS code belongs outside `scene/`. The scene receives plain data props (a list of entity objects); it does not fetch or compute debt signals itself.

## Data and API

- **GitHub REST API** — accessed through the client in `lib/github/`. An optional user-supplied personal access token unlocks higher rate limits. Without a token the app uses the unauthenticated limit.
- **Three pre-cached demo repositories** — stored as static JSON fixtures so judges and reviewers can explore the full experience without a token or network access. The cache is checked before any live API call.

## Scanner logic

- Detectors live in `scanner/` as **pure functions**: given file contents or metadata, return findings. They accept no global state, perform no I/O, and have no side effects.
- Fetching (GitHub API calls) and scanning (pure analysis) are strictly separated. A `lib/github/` function fetches raw data; a `scanner/` function analyses it.
- This separation makes detectors trivially testable and reusable.

## Testing

- **Vitest** — test runner for all unit and integration tests.
- **fast-check** — property-based tests for scanner logic. Every detector must have at least one property-based test covering its core invariant (e.g. "a file with zero external imports is always flagged as dead code").

## Deployment

- **Vercel** — the production target. No server-side secrets that can't be expressed as Vercel environment variables. The app must deploy with `vercel --prod` from a clean checkout.
