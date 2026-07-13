import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const frontendExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const forbiddenFrontendSecret =
  /\bVITE_(?=[A-Z0-9_]*TISS)(?=[A-Z0-9_]*(?:CERT|CERTIFICATE|PASSWORD))[A-Z0-9_]+\b/g;

function listFrontendFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return listFrontendFiles(path);
    return frontendExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

describe("frontend environment security", () => {
  it("does not expose TISS certificate or password variables through VITE", () => {
    const root = process.cwd();
    const files = [resolve(root, ".env.example"), ...listFrontendFiles(resolve(root, "src"))];
    const violations = files.flatMap((file) => {
      const matches = readFileSync(file, "utf8").match(forbiddenFrontendSecret) ?? [];
      return matches.map((variable) => `${relative(root, file)}: ${variable}`);
    });

    expect(violations, "TISS certificate material must remain backend-only").toEqual([]);
  });
});
