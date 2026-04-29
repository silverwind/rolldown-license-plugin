import {readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, mkdtempSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {readFile, readdir} from "node:fs/promises";
import {build} from "rolldown";
import type {Plugin} from "rolldown";
import {licensePlugin, findPkgRoot} from "./index.ts";
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
  const min = times[0];
  console.info(`${label.padEnd(40)} med: ${med.toFixed(1)}ms  min: ${min.toFixed(1)}ms`);
}

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

const runBuild = (plugins: Plugin[]) => build({
  input: join(tmpDir, "entry.js"),
  resolve: {modules: [nmDir]},
  write: false, logLevel: "silent",
  plugins,
});

try {
  console.info("Building bundle...");
  let bundleResult: LicenseInfo[] = [];
  await runBuild([licensePlugin({done(licenses) { bundleResult = licenses; }})]);
  console.info(`Found ${bundleResult.length} packages with ${bundleResult.filter((entry) => entry.licenseText).length} license files\n`);

  await bench("full build + plugin", async () => {
    await runBuild([licensePlugin({done() {}})]);
  });

  type FakeBundle = Record<string, {type: string, modules: Record<string, object>}>;
  const capturedBundle: FakeBundle = {};
  await runBuild([{
    name: "capture",
    generateBundle(_opts, bundle) {
      for (const [key, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk") continue;
        const modules: Record<string, object> = {};
        for (const moduleId of Object.keys(chunk.modules)) modules[moduleId] = {};
        capturedBundle[key] = {type: "chunk", modules};
      }
    },
  }]);

  const moduleCount = Object.values(capturedBundle).reduce((sum, chunk) => sum + Object.keys(chunk.modules).length, 0);
  console.info(`\nCaptured bundle: ${moduleCount} modules`);

  await bench("generateBundle only", async () => {
    const plugin = licensePlugin({done() {}});
    await (plugin as any).generateBundle({}, capturedBundle);
  });

  const licenseRe = /^((UN)?LICEN(S|C)E|COPYING).*$/i;

  const benchDirs: string[] = [];
  {
    const roots = new Set<string>();
    for (const chunk of Object.values(capturedBundle)) {
      if (chunk.type !== "chunk") continue;
      for (const moduleId of Object.keys(chunk.modules)) {
        const qIdx = moduleId.indexOf("?");
        const root = findPkgRoot(qIdx === -1 ? moduleId : moduleId.slice(0, qIdx));
        if (root) roots.add(root);
      }
    }
    for (const dir of roots) benchDirs.push(dir);
  }

  await bench("phase: pkg.json read", () => {
    let count = 0;
    for (const dir of benchDirs) {
      try {
        if (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name) count++;
      } catch {}
    }
    return count;
  });

  await bench("phase: license readdir+read (parallel)", async () => {
    await Promise.all(benchDirs.map(async (dir) => {
      try {
        const files = await readdir(dir);
        const found = files.find((entry) => licenseRe.test(entry));
        if (found) await readFile(join(dir, found), "utf8");
      } catch {}
    }));
  });

  await bench("phase: license readdir+read (sync)", () => {
    for (const dir of benchDirs) {
      try {
        const files = readdirSync(dir);
        const found = files.find((entry) => licenseRe.test(entry));
        if (found) readFileSync(join(dir, found), "utf8");
      } catch {}
    }
  });
} finally {
  rmSync(tmpDir, {recursive: true});
}
