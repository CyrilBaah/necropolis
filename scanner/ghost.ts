import type { SourceFile, GraveyardEntity } from "./types.js";
import { entityId } from "./id.js";

/**
 * Detect ghost signals: deferred-comment debt and skipped tests.
 *
 * Two independent signals are detected in a single pass over each file's lines:
 *
 * 1. **Deferred comments** — lines containing TODO, FIXME, or HACK as whole
 *    tokens (case-insensitive), excluding matches that appear inside URLs.
 *    All occurrences in a file are grouped into one entity. Severity scales
 *    with count: 1–4 comments = severity 1; 5+ comments = severity 2.
 *
 * 2. **Skipped tests** — lines using `it.skip`, `test.skip`, `xit`, `xtest`,
 *    `xdescribe`, or `describe.skip`. Each occurrence is its own entity,
 *    identified by file path and 1-based line number. Severity is always 2.
 *
 * @param files - List of source files from the repository.
 * @returns Array of ghost entities (deferred comments and skipped tests).
 */
export function detectGhosts(files: SourceFile[]): GraveyardEntity[] {
  if (!files || !Array.isArray(files) || files.length === 0) {
    return [];
  }

  const entities: GraveyardEntity[] = [];

  for (const file of files) {
    if (!file || typeof file !== "object") {
      continue;
    }

    const path = typeof file.path === "string" ? file.path : "";
    const content = typeof file.content === "string" ? file.content : "";

    const deferredLines: Array<{ lineNumber: number; text: string }> = [];

    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const lineNumber = i + 1; // 1-based

      // --- Pass 1: deferred comments ---
      // Match TODO / FIXME / HACK as whole tokens, but not inside URLs (://)
      if (DEFERRED_PATTERN.test(line) && !URL_PATTERN.test(line)) {
        deferredLines.push({ lineNumber, text: line.trim() });
      }

      // --- Pass 2: skipped tests ---
      if (SKIP_PATTERN.test(line)) {
        const ref = `${path}:${lineNumber}`;
        entities.push({
          id: entityId("ghost", ref),
          type: "ghost",
          title: `Skipped test in ${path}`,
          ref,
          evidence: [
            { label: "File", value: path },
            { label: "Line", value: String(lineNumber) },
            { label: "Code", value: line.trim() },
          ],
          severity: 2,
          epitaph: `Here lies ${ref} — a test that never ran and never will.`,
          remediation: `Remove .skip from the test at ${ref}, or delete it`,
        });
      }
    }

    // Build one entity per file for deferred comments
    if (deferredLines.length > 0) {
      const count = deferredLines.length;
      const severity = count >= 5 ? 2 : 1;

      // Up to three sample lines as evidence
      const samples = deferredLines.slice(0, 3).map((l, idx) => ({
        label: `Comment ${idx + 1} (line ${l.lineNumber})`,
        value: l.text,
      }));

      entities.push({
        id: entityId("ghost", path),
        type: "ghost",
        title: path,
        ref: path,
        evidence: [
          { label: "Deferred comments", value: String(count) },
          ...samples,
        ],
        severity,
        epitaph: `Here lies ${path} — ${count} deferred ${count === 1 ? "promise" : "promises"}, none kept.`,
        remediation: `Address or remove the ${count} deferred comment${count === 1 ? "" : "s"} in ${path}`,
      });
    }
  }

  return entities;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * Matches TODO, FIXME, or HACK as whole tokens (word boundary on both sides),
 * case-insensitive.
 */
const DEFERRED_PATTERN = /\b(TODO|FIXME|HACK)\b/i;

/**
 * Detects URL context — if the line contains "://" we skip the deferred match
 * to avoid false positives like "https://github.com/todo-app".
 */
const URL_PATTERN = /:\/\//;

/**
 * Matches skipped test patterns as function-call forms.
 * Covers: it.skip(, test.skip(, xit(, xtest(, xdescribe(, describe.skip(
 */
const SKIP_PATTERN =
  /\b(it\.skip|test\.skip|xit|xtest|xdescribe|describe\.skip)\s*\(/;
