import type {
  SourceFile,
  PackageJson,
  GraveyardEntity,
} from "./types.js";
import { entityId } from "./id.js";

/**
 * Detect dead code: JS/TS files or exports that are never imported.
 *
 * Uses a regex-based heuristic to build an import graph. A file is dead if
 * it's not imported by any other file (and is not an entry point, config, or
 * test file). An export within a file is dead if the export name never appears
 * as an import specifier across the codebase.
 *
 * @param files - List of source files from the repository.
 * @param packageJson - Parsed package.json (or null if none exists). Used to identify entry points.
 * @returns Array of tombstone entities (dead files or dead exports).
 */
export function detectTombstones(
  files: SourceFile[],
  packageJson: PackageJson | null
): GraveyardEntity[] {
  if (!files || files.length === 0) {
    return [];
  }

  // Build a map of normalised file paths for quick lookup.
  const filePaths = new Set(files.map((f) => normalisePath(f.path)));

  // Collect all local imports across the codebase.
  const importGraph = new Map<string, Set<string>>(); // importer -> Set(imported paths)
  const allImportedPaths = new Set<string>();
  const importedSpecifiers = new Map<string, Set<string>>(); // file -> Set(imported names)

  for (const file of files) {
    const imports = extractImports(file.content, file.path, filePaths);
    importGraph.set(file.path, new Set(imports.map((i) => i.path)));
    for (const imp of imports) {
      allImportedPaths.add(imp.path);
      if (imp.specifiers.length > 0) {
        if (!importedSpecifiers.has(imp.path)) {
          importedSpecifiers.set(imp.path, new Set());
        }
        for (const spec of imp.specifiers) {
          importedSpecifiers.get(imp.path)!.add(spec);
        }
      }
      // If import uses namespace (import * as x), mark the file as "fully referenced"
      if (imp.isNamespace) {
        importedSpecifiers.set(imp.path, new Set(["*"]));
      }
    }
  }

  // Identify entry points from package.json
  const entryPoints = new Set<string>();
  if (packageJson) {
    if (packageJson.main) {
      entryPoints.add(resolveEntryPoint(packageJson.main));
    }
    // Handle "exports" field (simplified — only extract string values)
    if (packageJson.exports) {
      extractExportPaths(packageJson.exports).forEach((p) =>
        entryPoints.add(resolveEntryPoint(p))
      );
    }
  }
  // Add common entry point filenames (store normalised, i.e. without extension)
  for (const name of ["index", "main", "app"]) {
    entryPoints.add(name);
    // Also match nested entry points like src/index.ts
    entryPoints.add(`src/${name}`);
  }

  const entities: GraveyardEntity[] = [];

  // Check each file for deadness
  for (const file of files) {
    const normPath = normalisePath(file.path);

    // Skip entry points, config files, and test files
    if (isExcludedFile(file.path, entryPoints)) {
      continue;
    }

    const isImported = allImportedPaths.has(normPath);

    if (!isImported) {
      // Dead file — report one entity for the entire file
      entities.push({
        id: entityId("tombstone", file.path),
        type: "tombstone",
        title: file.path,
        ref: file.path,
        evidence: [
          { label: "Imported by", value: "0 files" },
          { label: "Type", value: "Dead file" },
        ],
        severity: 2,
        epitaph: `Here lies ${file.path} — exported to the world, received by none.`,
        remediation: `git rm ${file.path}`,
      });
    } else {
      // File is imported — check for dead exports
      const exports = extractExports(file.content);
      const referencedSpecifiers = importedSpecifiers.get(normPath) || new Set();

      // If any import uses namespace, skip dead-export detection
      if (referencedSpecifiers.has("*")) {
        continue;
      }

      for (const exp of exports) {
        if (!referencedSpecifiers.has(exp)) {
          entities.push({
            id: entityId("tombstone", `${file.path}:${exp}`),
            type: "tombstone",
            title: `${exp} (in ${file.path})`,
            ref: `${file.path}:${exp}`,
            evidence: [
              { label: "Export name", value: exp },
              { label: "Imported by", value: "0 files" },
              { label: "Type", value: "Dead export" },
            ],
            severity: 1,
            epitaph: `Here lies ${file.path}:${exp} — exported to the world, received by none.`,
            remediation: `Remove the export keyword from ${exp} in ${file.path}`,
          });
        }
      }
    }
  }

  return entities;
}

// ---------------------------------------------------------------------------
// Path normalisation
// ---------------------------------------------------------------------------

function normalisePath(path: string): string {
  // Remove leading ./ and trailing extensions
  return path.replace(/^\.\//, "").replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
}

function resolveEntryPoint(rawPath: string): string {
  // Strip leading ./ and extension
  return rawPath.replace(/^\.\//, "").replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
}

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

interface Import {
  path: string; // normalised path
  specifiers: string[]; // named imports (empty for side-effect or default-only)
  isNamespace: boolean; // true if import * as x
}

function extractImports(
  content: string,
  filePath: string,
  allFilePaths: Set<string>
): Import[] {
  const imports: Import[] = [];
  const lines = content.split("\n");

  // Regex patterns for local imports
  const importFromPattern = /import\s+(?:(.*?)\s+from\s+)?['"](\.[^'"]+)['"]/g;
  const requirePattern = /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;

  for (const line of lines) {
    // Match ES6 imports — process the full line, not per-character
    let match: RegExpExecArray | null;
    const importFromRegex = new RegExp(importFromPattern.source, "g");
    while ((match = importFromRegex.exec(line)) !== null) {
      const importClause = match[1] || "";
      const rawPath = match[2];
      const resolved = resolveImportPath(rawPath, filePath, allFilePaths);
      if (resolved) {
        // Namespace check runs on the full line to catch "import * as x from"
        const isNamespace = /import\s+\*\s+as\s+/.test(line);
        const specifiers = extractImportSpecifiers(importClause);
        imports.push({ path: resolved, specifiers, isNamespace });
      }
    }

    // Match CommonJS requires
    const requireRegex = new RegExp(requirePattern.source, "g");
    while ((match = requireRegex.exec(line)) !== null) {
      const rawPath = match[1];
      const resolved = resolveImportPath(rawPath, filePath, allFilePaths);
      if (resolved) {
        imports.push({ path: resolved, specifiers: [], isNamespace: false });
      }
    }
  }

  return imports;
}

function extractImportSpecifiers(importClause: string): string[] {
  // Extract named imports from "{ a, b, c }" or "a, { b, c }"
  const namedMatch = importClause.match(/\{\s*([^}]+)\s*\}/);
  if (!namedMatch) {
    return [];
  }
  return namedMatch[1]
    .split(",")
    .map((s) => s.trim().replace(/\s+as\s+.*$/, ""))
    .filter(Boolean);
}

function resolveImportPath(
  rawPath: string,
  importerPath: string,
  allFilePaths: Set<string>
): string | null {
  // Only process relative imports (. or ..)
  if (!rawPath.startsWith(".")) {
    return null;
  }

  // Compute the directory of the importing file
  const importerDir = importerPath.includes("/")
    ? importerPath.substring(0, importerPath.lastIndexOf("/"))
    : "";

  // Resolve relative path
  const resolved = resolvePath(importerDir, rawPath);

  // Normalise and try variations
  const normalised = normalisePath(resolved);

  // Try exact match first
  if (allFilePaths.has(normalised)) {
    return normalised;
  }

  // Try adding extensions
  for (const ext of ["ts", "tsx", "js", "jsx", "mjs", "cjs"]) {
    if (allFilePaths.has(`${normalised}.${ext}`)) {
      return normalisePath(`${normalised}.${ext}`);
    }
  }

  // Try index file
  for (const ext of ["ts", "tsx", "js", "jsx"]) {
    if (allFilePaths.has(`${normalised}/index.${ext}`)) {
      return normalisePath(`${normalised}/index.${ext}`);
    }
  }

  return null;
}

function resolvePath(base: string, relative: string): string {
  const parts = base.split("/").filter(Boolean);
  const relativeParts = relative.split("/").filter(Boolean);

  for (const part of relativeParts) {
    if (part === "..") {
      parts.pop();
    } else if (part !== ".") {
      parts.push(part);
    }
  }

  return parts.join("/");
}

// ---------------------------------------------------------------------------
// Export extraction
// ---------------------------------------------------------------------------

function extractExports(content: string): string[] {
  const exports: string[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    // Match: export function name, export const name, export class name
    const declMatch = line.match(
      /export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/
    );
    if (declMatch) {
      exports.push(declMatch[1]);
      continue;
    }

    // Match: export default
    if (/export\s+default\b/.test(line)) {
      exports.push("default");
      continue;
    }

    // Match: export { a, b, c }
    const namedMatch = line.match(/export\s+\{\s*([^}]+)\s*\}/);
    if (namedMatch) {
      const names = namedMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/\s+as\s+.*$/, ""))
        .filter(Boolean);
      exports.push(...names);
    }
  }

  return exports;
}

// ---------------------------------------------------------------------------
// Exclusion rules
// ---------------------------------------------------------------------------

function isExcludedFile(path: string, entryPoints: Set<string>): boolean {
  const norm = normalisePath(path);

  // Entry points
  if (entryPoints.has(norm)) {
    return true;
  }

  // Config files
  if (
    /\.(config|rc)\.(ts|js|mjs|cjs|json)$/.test(path) ||
    /^\.[a-z]+rc\.(ts|js|json)$/.test(path) ||
    path.startsWith("config/")
  ) {
    return true;
  }

  // Test files
  if (
    path.includes("__tests__") ||
    path.includes(".test.") ||
    path.includes(".spec.") ||
    path.includes("/tests/") ||
    path.startsWith("tests/")
  ) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// package.json "exports" field parser
// ---------------------------------------------------------------------------

function extractExportPaths(exports: unknown): string[] {
  const paths: string[] = [];

  if (typeof exports === "string") {
    paths.push(exports);
  } else if (typeof exports === "object" && exports !== null) {
    for (const value of Object.values(exports)) {
      if (typeof value === "string") {
        paths.push(value);
      } else if (typeof value === "object" && value !== null) {
        // Nested "exports" (e.g. { ".": { "import": "./foo.js" } })
        paths.push(...extractExportPaths(value));
      }
    }
  }

  return paths;
}
