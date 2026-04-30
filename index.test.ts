import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {build} from "rolldown";
import {build as tsdownBuild} from "tsdown";
import {build as viteBuild} from "vite";
import {licensePlugin, findPkgRoot} from "./index.ts";
import type {LicenseInfo} from "./index.ts";

const fixturesDir = join(import.meta.dirname, "fixtures");

async function buildWithPlugin(opts: Partial<Omit<Parameters<typeof licensePlugin>[0], "done">> = {}): Promise<LicenseInfo[]> {
  let result: LicenseInfo[] = [];
  await build({
    input: join(fixturesDir, "entry.js"),
    resolve: {
      modules: [join(fixturesDir, "node_modules")],
    },
    write: false,
    plugins: [licensePlugin({...opts, done(licenses) { result = licenses; }})],
  });
  return result;
}

test("collects licenses from bundled dependencies", async () => {
  const result = await buildWithPlugin();

  expect(result).toHaveLength(5);

  expect(result[0]).toEqual({
    name: "test-pkg-a",
    version: "1.0.0",
    license: "MIT",
    licenseText: expect.stringContaining("MIT License"),
  });

  expect(result[1]).toEqual({
    name: "test-pkg-b",
    version: "2.0.0",
    license: "ISC",
    licenseText: "",
  });

  expect(result[2]).toEqual({
    name: "test-pkg-c",
    version: "3.0.0",
    license: "Apache-2.0",
    licenseText: "",
  });

  expect(result[3]).toEqual({
    name: "test-pkg-d",
    version: "4.0.0",
    license: "MIT OR Apache-2.0",
    licenseText: "",
  });

  expect(result[4]).toEqual({
    name: "test-pkg-e",
    version: "5.0.0",
    license: "",
    licenseText: "",
  });
});

test("wrapLicenseText wraps license text to specified width", async () => {
  const result = await buildWithPlugin({wrapLicenseText: 80});

  const pkg = result.find((entry) => entry.name === "test-pkg-a")!;
  for (const line of pkg.licenseText.split("\n")) {
    expect(line.length).toBeLessThanOrEqual(80);
  }
  expect(pkg.licenseText).toContain("MIT License");
  expect(pkg.licenseText).toContain("\n");
});

test("wrapLicenseText preserves blank lines", async () => {
  const result = await buildWithPlugin({wrapLicenseText: 80});

  const pkg = result.find((entry) => entry.name === "test-pkg-a")!;
  expect(pkg.licenseText).toContain("\n\n");
});

test("allow warns by default without failing", async () => {
  const result = await buildWithPlugin({allow: (dep) => dep.license === "MIT"});
  expect(result).toHaveLength(5);
});

test("failOnViolation throws on license mismatch", async () => {
  await expect(buildWithPlugin({
    allow: (dep) => dep.license === "MIT",
    failOnViolation: true,
  })).rejects.toThrow("incompatible license");
});

test("failOnUnlicensed throws on missing license", async () => {
  await expect(buildWithPlugin({
    allow: (dep) => Boolean(dep.license),
    failOnUnlicensed: true,
  })).rejects.toThrow("does not specify any license");
});

test("failOnViolation does not throw for unlicensed", async () => {
  const result = await buildWithPlugin({
    allow: (dep) => Boolean(dep.license),
    failOnViolation: true,
  });
  expect(result).toHaveLength(5);
});

test("failOnUnlicensed does not throw for license mismatch", async () => {
  const result = await buildWithPlugin({
    allow: (dep) => !dep.license || dep.license === "MIT",
    failOnUnlicensed: true,
  });
  expect(result).toHaveLength(5);
});

test("allow passes when all licenses match", async () => {
  const result = await buildWithPlugin({allow: () => true});
  expect(result).toHaveLength(5);
});

const manyDeps: {name: string, version: string, license: string, hasText: boolean}[] = [
  {name: "@citation-js/core", version: "0.7.21", license: "MIT", hasText: true},
  {name: "@citation-js/plugin-bibtex", version: "0.7.21", license: "MIT", hasText: true},
  {name: "@citation-js/plugin-csl", version: "0.7.22", license: "MIT", hasText: true},
  {name: "@citation-js/plugin-software-formats", version: "0.6.2", license: "MIT", hasText: true},
  {name: "@codemirror/autocomplete", version: "6.20.1", license: "MIT", hasText: true},
  {name: "@codemirror/commands", version: "6.10.3", license: "MIT", hasText: true},
  {name: "@codemirror/lang-json", version: "6.0.2", license: "MIT", hasText: true},
  {name: "@codemirror/lang-markdown", version: "6.5.0", license: "MIT", hasText: true},
  {name: "@codemirror/language", version: "6.12.3", license: "MIT", hasText: true},
  {name: "@codemirror/language-data", version: "6.5.2", license: "MIT", hasText: true},
  {name: "@codemirror/legacy-modes", version: "6.5.2", license: "MIT", hasText: true},
  {name: "@codemirror/lint", version: "6.9.5", license: "MIT", hasText: true},
  {name: "@codemirror/search", version: "6.6.0", license: "MIT", hasText: true},
  {name: "@codemirror/state", version: "6.6.0", license: "MIT", hasText: true},
  {name: "@codemirror/view", version: "6.41.0", license: "MIT", hasText: true},
  {name: "@github/markdown-toolbar-element", version: "2.2.3", license: "MIT", hasText: true},
  {name: "@github/paste-markdown", version: "1.5.3", license: "MIT", hasText: true},
  {name: "@github/text-expander-element", version: "2.9.4", license: "MIT", hasText: true},
  {name: "@lezer/highlight", version: "1.2.3", license: "MIT", hasText: true},
  {name: "@mcaptcha/vanilla-glue", version: "0.1.0-alpha-3", license: "(MIT OR Apache-2.0)", hasText: false},
  {name: "@mermaid-js/layout-elk", version: "0.2.1", license: "MIT", hasText: true},
  {name: "@primer/octicons", version: "19.23.1", license: "MIT", hasText: true},
  {name: "@replit/codemirror-indentation-markers", version: "6.5.3", license: "MIT", hasText: true},
  {name: "@replit/codemirror-lang-nix", version: "6.0.1", license: "MIT", hasText: true},
  {name: "@replit/codemirror-lang-svelte", version: "6.0.0", license: "MIT", hasText: true},
  {name: "@replit/codemirror-vscode-keymap", version: "6.0.2", license: "MIT", hasText: false},
  {name: "@resvg/resvg-wasm", version: "2.6.2", license: "MPL-2.0", hasText: false},
  {name: "@silverwind/vue3-calendar-heatmap", version: "2.1.1", license: "MIT", hasText: true},
  {name: "@vitejs/plugin-vue", version: "6.0.5", license: "MIT", hasText: true},
  {name: "ansi_up", version: "6.0.6", license: "MIT", hasText: true},
  {name: "asciinema-player", version: "3.15.1", license: "Apache-2.0", hasText: true},
  {name: "chart.js", version: "4.5.1", license: "MIT", hasText: true},
  {name: "chartjs-adapter-dayjs-4", version: "1.0.4", license: "MIT", hasText: false},
  {name: "chartjs-plugin-zoom", version: "2.2.0", license: "MIT", hasText: true},
  {name: "clippie", version: "4.1.10", license: "BSD-2-Clause", hasText: true},
  {name: "codemirror-lang-elixir", version: "4.0.1", license: "Apache-2.0", hasText: true},
  {name: "colord", version: "2.9.3", license: "MIT", hasText: true},
  {name: "compare-versions", version: "6.1.1", license: "MIT", hasText: true},
  {name: "cropperjs", version: "1.6.2", license: "MIT", hasText: true},
  {name: "dayjs", version: "1.11.20", license: "MIT", hasText: true},
  {name: "dropzone", version: "6.0.0-beta.2", license: "MIT", hasText: true},
  {name: "easymde", version: "2.20.0", license: "MIT", hasText: true},
  {name: "esbuild", version: "0.28.0", license: "MIT", hasText: true},
  {name: "htmx.org", version: "2.0.8", license: "0BSD", hasText: true},
  {name: "idiomorph", version: "0.7.4", license: "0BSD", hasText: true},
  {name: "jquery", version: "4.0.0", license: "MIT", hasText: true},
  {name: "js-yaml", version: "4.1.1", license: "MIT", hasText: true},
  {name: "katex", version: "0.16.45", license: "MIT", hasText: true},
  {name: "mermaid", version: "11.14.0", license: "MIT", hasText: true},
  {name: "online-3d-viewer", version: "0.18.0", license: "MIT", hasText: true},
  {name: "pdfobject", version: "2.3.1", license: "MIT", hasText: true},
  {name: "perfect-debounce", version: "2.1.0", license: "MIT", hasText: true},
  {name: "postcss", version: "8.5.9", license: "MIT", hasText: true},
  {name: "rolldown-license-plugin", version: "2.2.0", license: "BSD-2-Clause", hasText: true},
  {name: "sortablejs", version: "1.15.7", license: "MIT", hasText: true},
  {name: "swagger-ui-dist", version: "5.32.2", license: "Apache-2.0", hasText: true},
  {name: "tailwindcss", version: "3.4.19", license: "MIT", hasText: true},
  {name: "throttle-debounce", version: "5.0.2", license: "MIT", hasText: true},
  {name: "tippy.js", version: "6.3.7", license: "MIT", hasText: true},
  {name: "toastify-js", version: "1.12.0", license: "MIT", hasText: true},
  {name: "tributejs", version: "5.1.3", license: "MIT", hasText: true},
  {name: "uint8-to-base64", version: "0.2.1", license: "ISC", hasText: true},
  {name: "vanilla-colorful", version: "0.7.2", license: "MIT", hasText: true},
  {name: "vite", version: "8.0.7", license: "MIT", hasText: true},
  {name: "vite-string-plugin", version: "2.0.2", license: "BSD-2-Clause", hasText: true},
  {name: "vue", version: "3.5.32", license: "MIT", hasText: true},
  {name: "vue-bar-graph", version: "2.2.0", license: "MIT", hasText: false},
  {name: "vue-chartjs", version: "5.3.3", license: "MIT", hasText: true},
];

test("many packages with scoped names and diverse licenses", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "license-test-"));
  const nm = join(tmp, "node_modules");

  const modules: Record<string, object> = {};
  for (const dep of manyDeps) {
    const dir = join(nm, dep.name);
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, "package.json"), JSON.stringify({name: dep.name, version: dep.version, license: dep.license}));
    if (dep.hasText) writeFileSync(join(dir, "LICENSE"), `${dep.license} License\nCopyright (c) ${dep.name}`);
    modules[join(dir, "index.js")] = {};
  }

  let result: LicenseInfo[] = [];
  const plugin = licensePlugin({done(licenses) { result = licenses; }});
  await (plugin as any).generateBundle.call({}, {}, {chunk: {type: "chunk", modules}});
  rmSync(tmp, {recursive: true});

  expect(result.map(({name, version, license, licenseText}) => ({
    name, version, license, hasText: licenseText.length > 0,
  }))).toEqual(manyDeps);
});

test("works with tsdown", async () => {
  let result: LicenseInfo[] = [];
  const outDir = mkdtempSync(join(tmpdir(), "tsdown-test-"));
  await tsdownBuild({
    config: false,
    entry: [join(fixturesDir, "entry.js")],
    plugins: [licensePlugin({done(licenses) { result = licenses; }})],
    inputOptions: {
      resolve: {
        modules: [join(fixturesDir, "node_modules")],
      },
    },
    outDir,
    dts: false,
  });
  rmSync(outDir, {recursive: true, force: true});

  expect(result).toHaveLength(5);
  expect(result[0]).toEqual({
    name: "test-pkg-a",
    version: "1.0.0",
    license: "MIT",
    licenseText: expect.stringContaining("MIT License"),
  });
});

test("works with vite", async () => {
  let result: LicenseInfo[] = [];
  await viteBuild({
    root: fixturesDir,
    plugins: [licensePlugin({done(licenses) { result = licenses; }})],
    build: {
      lib: {
        entry: join(fixturesDir, "entry.js"),
        formats: ["es"],
      },
      write: false,
    },
    logLevel: "silent",
  });

  expect(result).toHaveLength(5);
  expect(result[0]).toEqual({
    name: "test-pkg-a",
    version: "1.0.0",
    license: "MIT",
    licenseText: expect.stringContaining("MIT License"),
  });
});

test("findPkgRoot resolves package roots", () => {
  expect(findPkgRoot("/x/node_modules/pkg/lib/foo.js")).toBe("/x/node_modules/pkg");
  expect(findPkgRoot("/x/node_modules/pkg/index.js")).toBe("/x/node_modules/pkg");
  expect(findPkgRoot("/x/node_modules/pkg")).toBe("/x/node_modules/pkg");
  expect(findPkgRoot("/x/node_modules/@scope/pkg/lib/foo.js")).toBe("/x/node_modules/@scope/pkg");
  expect(findPkgRoot("/x/node_modules/@scope/pkg")).toBe("/x/node_modules/@scope/pkg");
  expect(findPkgRoot("/x/node_modules/a/node_modules/b/lib/foo.js")).toBe("/x/node_modules/a/node_modules/b");
  expect(findPkgRoot("/x/node_modules/@s/a/node_modules/@t/b/foo.js")).toBe("/x/node_modules/@s/a/node_modules/@t/b");
});

test("findPkgRoot returns null for invalid paths", () => {
  expect(findPkgRoot("/x/no-modules/foo.js")).toBeNull();
  expect(findPkgRoot("/x/node_modules/@scope")).toBeNull();
  expect(findPkgRoot("/x/node_modules/@")).toBeNull();
  expect(findPkgRoot("")).toBeNull();
});
