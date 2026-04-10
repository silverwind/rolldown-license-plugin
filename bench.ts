import {readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, mkdtempSync} from "node:fs";
import {join, dirname} from "node:path";
import {tmpdir} from "node:os";
import {readFile, readdir} from "node:fs/promises";
import {build} from "rolldown";
import {licensePlugin} from "./index.ts";
import type {LicenseInfo} from "./index.ts";

const iterations = 10;

async function bench(label: string, fn: () => unknown | Promise<unknown>) {
  await fn(); // warmup
  const times: number[] = [];
  for (let idx = 0; idx < iterations; idx++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const med = times[Math.floor(times.length / 2)];
  const min = Math.min(...times);
  console.info(`${label.padEnd(40)} med: ${med.toFixed(1)}ms  min: ${min.toFixed(1)}ms`);
}

// Create realistic fixture: many packages with varying directory structures
const tmpDir = mkdtempSync(join(tmpdir(), "license-bench-"));
const nmDir = join(tmpDir, "node_modules");
const pkgCount = 900;

console.info(`Creating ${pkgCount} fixture packages...`);
for (let idx = 0; idx < pkgCount; idx++) {
  const name = `bench-pkg-${String(idx).padStart(4, "0")}`;
  const pkgDir = join(nmDir, name);
  const libDir = join(pkgDir, "lib");
  mkdirSync(libDir, {recursive: true});
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({name, version: "1.0.0", license: "MIT"}));
  if (idx % 3 !== 0) writeFileSync(join(pkgDir, "LICENSE"), `MIT License\nCopyright (c) ${name}`);
  writeFileSync(join(pkgDir, "index.js"), `export const x${idx} = "${name}";`);
  writeFileSync(join(libDir, "util.js"), `export const u${idx} = "${name}-util";`);
  for (let fileIdx = 0; fileIdx < 10; fileIdx++) {
    writeFileSync(join(pkgDir, `file${fileIdx}.js`), `// filler`);
  }
  // Simulate nested node_modules for every 10th package
  if (idx % 10 === 0 && idx > 0) {
    const nestedName = `${name}-nested`;
    const nestedDir = join(pkgDir, "node_modules", nestedName);
    mkdirSync(join(nestedDir, "lib"), {recursive: true});
    writeFileSync(join(nestedDir, "package.json"), JSON.stringify({name: nestedName, version: "0.1.0", license: "ISC"}));
    writeFileSync(join(nestedDir, "index.js"), `export const n${idx} = "${nestedName}";`);
    writeFileSync(join(nestedDir, "LICENSE"), `ISC License\nCopyright (c) ${nestedName}`);
  }
}

const importLines: string[] = [];
for (let idx = 0; idx < pkgCount; idx++) {
  const name = `bench-pkg-${String(idx).padStart(4, "0")}`;
  importLines.push(`export {x${idx}} from "${name}";`);
  importLines.push(`export {u${idx}} from "${name}/lib/util.js";`);
}
writeFileSync(join(tmpDir, "entry.js"), importLines.join("\n"));

try {
  console.info("Building bundle...");
  let bundleResult: LicenseInfo[] = [];
  await build({
    input: join(tmpDir, "entry.js"),
    resolve: {modules: [nmDir]},
    write: false, logLevel: "silent",
    plugins: [licensePlugin({done(licenses) { bundleResult = licenses; }})],
  });
  console.info(`Found ${bundleResult.length} packages with ${bundleResult.filter((l) => l.licenseText).length} license files\n`);

  // Benchmark the full plugin via rolldown build
  await bench("full build + plugin", async () => {
    await build({
      input: join(tmpDir, "entry.js"),
      resolve: {modules: [nmDir]},
      write: false, logLevel: "silent",
      plugins: [licensePlugin({done() {}})],
    });
  });

  // Benchmark just the plugin's generateBundle with a captured bundle
  type FakeBundle = Record<string, {type: string, modules: Record<string, object>}>;
  const capturedBundle: FakeBundle = {};
  await build({
    input: join(tmpDir, "entry.js"),
    resolve: {modules: [nmDir]},
    write: false, logLevel: "silent",
    plugins: [{
      name: "capture",
      generateBundle(_opts, bundle) {
        for (const [key, chunk] of Object.entries(bundle)) {
          if (chunk.type !== "chunk") continue;
          const modules: Record<string, object> = {};
          for (const moduleId of Object.keys(chunk.modules)) modules[moduleId] = {};
          capturedBundle[key] = {type: "chunk", modules};
        }
      },
    }],
  });

  const moduleCount = Object.values(capturedBundle).reduce((s, c) => s + Object.keys(c.modules).length, 0);
  console.info(`\nCaptured bundle: ${moduleCount} modules`);

  await bench("generateBundle only", async () => {
    const plugin = licensePlugin({done() {}});
    await (plugin as any).generateBundle({}, capturedBundle);
  });

  // Benchmark individual phases
  const licenseRe = /^((UN)?LICEN(S|C)E|COPYING).*$/i;

  await bench("phase: pkg.json resolution", () => {
    const pkgJsonCache = new Map<string, any>();
    const pkgDirs = new Map<string, any>();
    for (const chunk of Object.values(capturedBundle)) {
      if (chunk.type !== "chunk") continue;
      for (const moduleId of Object.keys(chunk.modules)) {
        const fsPath = moduleId.split("?")[0];
        if (!fsPath.includes("node_modules")) continue;
        let dir = dirname(fsPath);
        const cached = pkgJsonCache.get(dir);
        if (cached !== undefined) { if (cached?.name) { const key = `${cached.name}@${cached.version}`; if (!pkgDirs.has(key)) pkgDirs.set(key, {dir, pkgJson: cached}); } continue; }
        let pkgJson: any = null;
        const walked: string[] = [];
        while (dir !== dirname(dir) && dir.includes("node_modules")) {
          const ci = pkgJsonCache.get(dir); if (ci !== undefined) { pkgJson = ci; break; }
          walked.push(dir);
          try { pkgJson = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); } catch { pkgJson = null; }
          if (pkgJson?.name) break;
          pkgJson = null; dir = dirname(dir);
        }
        for (const w of walked) pkgJsonCache.set(w, pkgJson);
        if (!pkgJson?.name) continue;
        const key = `${pkgJson.name}@${pkgJson.version}`;
        if (!pkgDirs.has(key)) pkgDirs.set(key, {dir, pkgJson});
      }
    }
    return pkgDirs.size;
  });

  // Collect dirs for license phase benchmark
  const benchDirs: string[] = [];
  {
    const pkgJsonCache = new Map<string, any>();
    const seen = new Set<string>();
    for (const chunk of Object.values(capturedBundle)) {
      if (chunk.type !== "chunk") continue;
      for (const moduleId of Object.keys(chunk.modules)) {
        const fsPath = moduleId.split("?")[0];
        if (!fsPath.includes("node_modules")) continue;
        let dir = dirname(fsPath);
        const cached = pkgJsonCache.get(dir);
        if (cached !== undefined) continue;
        let pkgJson: any = null;
        const walked: string[] = [];
        while (dir !== dirname(dir) && dir.includes("node_modules")) {
          const ci = pkgJsonCache.get(dir); if (ci !== undefined) { pkgJson = ci; break; }
          walked.push(dir);
          try { pkgJson = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); } catch { pkgJson = null; }
          if (pkgJson?.name) break; pkgJson = null; dir = dirname(dir);
        }
        for (const w of walked) pkgJsonCache.set(w, pkgJson);
        if (pkgJson?.name && !seen.has(`${pkgJson.name}@${pkgJson.version}`)) {
          seen.add(`${pkgJson.name}@${pkgJson.version}`);
          benchDirs.push(dir);
        }
      }
    }
  }

  await bench("phase: license readdir+read (parallel)", async () => {
    await Promise.all(benchDirs.map(async (dir) => {
      try {
        const files = await readdir(dir);
        const f = files.find((e) => licenseRe.test(e));
        if (f) await readFile(join(dir, f), "utf8");
      } catch {}
    }));
  });

  await bench("phase: license readdir+read (sync)", () => {
    for (const dir of benchDirs) {
      try {
        const files = readdirSync(dir);
        const f = files.find((e: string) => licenseRe.test(e));
        if (f) readFileSync(join(dir, f), "utf8");
      } catch {}
    }
  });
} finally {
  rmSync(tmpDir, {recursive: true});
}
