import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const loader = pathToFileURL(require.resolve("tsx")).href;
const scanner = fileURLToPath(new URL("../../src/policy/scanners/ts_scanner.ts", import.meta.url));

for (const name of ["repo with spaces", "repo [literal] {one,two}"]) {
  test(`scanner CLI treats the owned root literally: ${name}`, () => {
    const container = mkdtempSync(join(tmpdir(), "lex-scanner-root-"));
    const root = join(container, name);
    try {
      const files = [
        "src/index.ts",
        "src/nested/view.tsx",
        "src/types.d.ts",
        "node_modules/pkg/index.ts",
        "src/node_modules/pkg/index.ts",
        "src/.hidden.ts",
        "src/javascript.js",
      ];
      for (const file of files) {
        const target = join(root, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, "export class Included {}\n");
      }
      mkdirSync(join(root, "src/decoy.ts"));
      const sibling = join(container, "repo l one", "outside.ts");
      mkdirSync(dirname(sibling), { recursive: true });
      writeFileSync(sibling, "export class Outside {}\n");

      const child = spawnSync(process.execPath, ["--import", loader, scanner, root], {
        cwd: container,
        encoding: "utf8",
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 256 * 1024,
      });
      assert.ifError(child.error);
      assert.equal(child.signal, null);
      assert.equal(child.status, 0, child.stderr);
      const output = JSON.parse(child.stdout);
      assert.equal(output.language, "typescript");
      assert.deepEqual(output.files.map((file) => file.path.replaceAll("\\", "/")).sort(), [
        "src/index.ts",
        "src/nested/view.tsx",
      ]);
      for (const file of output.files) {
        assert.equal(isAbsolute(file.path), false);
        const inside = relative(root, resolve(root, file.path));
        assert.ok(inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside));
        assert.ok(file.declarations.some((entry) => entry.name === "Included"));
      }
    } finally {
      rmSync(container, { recursive: true, force: true });
    }
  });
}
