import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {build} from "rolldown";
import type {Plugin} from "rolldown";
import {build as tsdownBuild} from "tsdown";
import {build as viteBuild} from "vite";
import {licensePlugin, findPkgRoot, wrap} from "./index.ts";
import type {LicenseInfo, RolldownLicensePluginOpts} from "./index.ts";

type Opts = Omit<RolldownLicensePluginOpts, "done">;

const fixturesDir = join(import.meta.dirname, "fixtures");
const entry = join(fixturesDir, "entry.js");
const resolve = {modules: [join(fixturesDir, "node_modules")]};

const bundlers = {
  rolldown: (plugin: Plugin) => build({input: entry, resolve, write: false, plugins: [plugin]}),
  tsdown: async (plugin: Plugin) => {
    const outDir = mkdtempSync(join(tmpdir(), "tsdown-test-"));
    await tsdownBuild({config: false, entry: [entry], plugins: [plugin], inputOptions: {resolve}, outDir, dts: false});
    rmSync(outDir, {recursive: true, force: true});
  },
  vite: (plugin: Plugin) => viteBuild({root: fixturesDir, plugins: [plugin], build: {lib: {entry, formats: ["es"]}, write: false}, logLevel: "silent"}),
};

const expected = [
  {name: "test-pkg-a", version: "1.0.0", license: "MIT", licenseText: expect.stringContaining("MIT License")},
  {name: "test-pkg-b", version: "2.0.0", license: "ISC", licenseText: ""},
  {name: "test-pkg-c", version: "3.0.0", license: "Apache-2.0", licenseText: ""},
  {name: "test-pkg-d", version: "4.0.0", license: "MIT OR Apache-2.0", licenseText: ""},
  {name: "test-pkg-e", version: "5.0.0", license: "", licenseText: ""},
];

async function collect(run: (plugin: Plugin) => Promise<unknown>, opts: Opts = {}): Promise<LicenseInfo[]> {
  let result: LicenseInfo[] = [];
  await run(licensePlugin({...opts, done(licenses) { result = licenses; }}));
  return result;
}

async function expectLicenses(pkgs: [name: string, version: string, license: string, licenseFile: string, idSuffix?: string][], opts: Opts = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "license-test-"));
  const modules: Record<string, object> = {};
  const expectedLicenses: LicenseInfo[] = [];
  for (const [name, version, license, licenseFile, idSuffix = ""] of pkgs) {
    const dir = join(tmp, "node_modules", name);
    const licenseText = licenseFile ? `${license} License\nCopyright (c) ${name}` : "";
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, "package.json"), JSON.stringify({name, version, license}));
    if (licenseFile) writeFileSync(join(dir, licenseFile), licenseText);
    modules[`${join(dir, "index.js")}${idSuffix}`] = {};
    expectedLicenses.push({name, version, license, licenseText});
  }
  const result = await collect((plugin) => (plugin as any).generateBundle.call({}, {}, {chunk: {type: "chunk", modules}}), opts);
  rmSync(tmp, {recursive: true});
  expect(result).toEqual(expectedLicenses);
}

test.each(Object.entries(bundlers))("collects licenses from bundled dependencies with %s", async (_name, run) => {
  expect(await collect(run)).toEqual(expected);
});

test("wrapLicenseText wraps license text to specified width and preserves blank lines", async () => {
  expect((await collect(bundlers.rolldown, {wrapLicenseText: 80}))[0].licenseText).toBe("MIT License\n\nCopyright (c) Test\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of\nthis software and associated documentation files (the \"Software\"), to deal in\nthe Software without restriction.");
});

test("wrap expands tabs to 8-column stops and drops the space run at each break", () => {
  expect(wrap("a\tb\tc", 80)).toBe(`a${" ".repeat(7)}b${" ".repeat(7)}c`);
  expect(wrap("\tx", 80)).toBe(`${" ".repeat(8)}x`);
  expect(wrap("aaaaa  bbbbb", 5)).toBe("aaaaa\nbbbbb");
});

test("match with the global flag stays stateless on the readdir path and module id queries are stripped", async () => {
  await expectLicenses(Array.from({length: 6}, (_entry, idx) => [`flag-pkg-${idx}`, "1.0.0", "MIT", "LICENSE.md", idx ? "" : "?v=1&dep=/x/node_modules/flag-pkg-5/index.js"]), {match: /^licen[sc]e/gi});
});

const isMit = (dep: LicenseInfo) => dep.license === "MIT";
const hasLicense = (dep: LicenseInfo) => Boolean(dep.license);

test.each<[string, Opts]>([
  ["allow warns by default without failing", {allow: isMit}],
  ["allow passes when all licenses match", {allow: () => true}],
  ["failOnViolation does not throw for unlicensed", {allow: hasLicense, failOnViolation: true}],
  ["failOnUnlicensed does not throw for license mismatch", {allow: (dep) => !dep.license || isMit(dep), failOnUnlicensed: true}],
])("%s", async (_name, opts) => {
  expect(await collect(bundlers.rolldown, opts)).toEqual(expected);
});

test.each<[string, Opts, RegExp | string]>([
  ["failOnViolation throws on license mismatch", {allow: isMit, failOnViolation: true, failOnUnlicensed: true}, /incompatible license[\s\S]*does not specify any license/],
  ["failOnUnlicensed throws on missing license", {allow: hasLicense, failOnUnlicensed: true}, "does not specify any license"],
])("%s", async (_name, opts, error) => {
  await expect(collect(bundlers.rolldown, opts)).rejects.toThrow(error);
});

test("many packages with scoped names and diverse licenses", async () => {
  await expectLicenses([
    ["@citation-js/core", "0.7.21", "MIT", "LICENSE"],
    ["@citation-js/plugin-bibtex", "0.7.21", "MIT", "LICENSE"],
    ["@citation-js/plugin-csl", "0.7.22", "MIT", "LICENSE"],
    ["@citation-js/plugin-software-formats", "0.6.2", "MIT", "LICENSE"],
    ["@codemirror/autocomplete", "6.20.1", "MIT", "LICENSE"],
    ["@codemirror/commands", "6.10.3", "MIT", "LICENSE"],
    ["@codemirror/lang-json", "6.0.2", "MIT", "LICENSE"],
    ["@codemirror/lang-markdown", "6.5.0", "MIT", "LICENSE"],
    ["@codemirror/language", "6.12.3", "MIT", "LICENSE"],
    ["@codemirror/language-data", "6.5.2", "MIT", "LICENSE"],
    ["@codemirror/legacy-modes", "6.5.2", "MIT", "LICENSE"],
    ["@codemirror/lint", "6.9.5", "MIT", "LICENSE"],
    ["@codemirror/search", "6.6.0", "MIT", "LICENSE"],
    ["@codemirror/state", "6.6.0", "MIT", "LICENSE"],
    ["@codemirror/view", "6.41.0", "MIT", "LICENSE"],
    ["@github/markdown-toolbar-element", "2.2.3", "MIT", "LICENSE"],
    ["@github/paste-markdown", "1.5.3", "MIT", "LICENSE"],
    ["@github/text-expander-element", "2.9.4", "MIT", "LICENSE"],
    ["@lezer/highlight", "1.2.3", "MIT", "LICENSE"],
    ["@mcaptcha/vanilla-glue", "0.1.0-alpha-3", "(MIT OR Apache-2.0)", ""],
    ["@mermaid-js/layout-elk", "0.2.1", "MIT", "LICENSE"],
    ["@primer/octicons", "19.23.1", "MIT", "LICENSE"],
    ["@replit/codemirror-indentation-markers", "6.5.3", "MIT", "LICENSE"],
    ["@replit/codemirror-lang-nix", "6.0.1", "MIT", "LICENSE"],
    ["@replit/codemirror-lang-svelte", "6.0.0", "MIT", "LICENSE"],
    ["@replit/codemirror-vscode-keymap", "6.0.2", "MIT", ""],
    ["@resvg/resvg-wasm", "2.6.2", "MPL-2.0", ""],
    ["@silverwind/vue3-calendar-heatmap", "2.1.1", "MIT", "LICENSE"],
    ["@vitejs/plugin-vue", "6.0.5", "MIT", "LICENSE"],
    ["ansi_up", "6.0.6", "MIT", "LICENSE"],
    ["asciinema-player", "3.15.1", "Apache-2.0", "LICENSE"],
    ["chart.js", "4.5.1", "MIT", "LICENSE"],
    ["chartjs-adapter-dayjs-4", "1.0.4", "MIT", ""],
    ["chartjs-plugin-zoom", "2.2.0", "MIT", "LICENSE"],
    ["clippie", "4.1.10", "BSD-2-Clause", "LICENSE"],
    ["codemirror-lang-elixir", "4.0.1", "Apache-2.0", "LICENSE"],
    ["colord", "2.9.3", "MIT", "LICENSE"],
    ["compare-versions", "6.1.1", "MIT", "LICENSE"],
    ["cropperjs", "1.6.2", "MIT", "LICENSE"],
    ["dayjs", "1.11.20", "MIT", "LICENSE"],
    ["dropzone", "6.0.0-beta.2", "MIT", "LICENSE"],
    ["easymde", "2.20.0", "MIT", "LICENSE"],
    ["esbuild", "0.28.0", "MIT", "LICENSE"],
    ["htmx.org", "2.0.8", "0BSD", "LICENSE"],
    ["idiomorph", "0.7.4", "0BSD", "LICENSE"],
    ["jquery", "4.0.0", "MIT", "LICENSE"],
    ["js-yaml", "4.1.1", "MIT", "LICENSE"],
    ["katex", "0.16.45", "MIT", "LICENSE"],
    ["mermaid", "11.14.0", "MIT", "LICENSE"],
    ["online-3d-viewer", "0.18.0", "MIT", "LICENSE"],
    ["pdfobject", "2.3.1", "MIT", "LICENSE"],
    ["perfect-debounce", "2.1.0", "MIT", "LICENSE"],
    ["postcss", "8.5.9", "MIT", "LICENSE"],
    ["rolldown-license-plugin", "2.2.0", "BSD-2-Clause", "LICENSE"],
    ["sortablejs", "1.15.7", "MIT", "LICENSE"],
    ["swagger-ui-dist", "5.32.2", "Apache-2.0", "LICENSE"],
    ["tailwindcss", "3.4.19", "MIT", "LICENSE"],
    ["throttle-debounce", "5.0.2", "MIT", "LICENSE"],
    ["tippy.js", "6.3.7", "MIT", "LICENSE"],
    ["toastify-js", "1.12.0", "MIT", "LICENSE"],
    ["tributejs", "5.1.3", "MIT", "LICENSE"],
    ["uint8-to-base64", "0.2.1", "ISC", "LICENSE"],
    ["vanilla-colorful", "0.7.2", "MIT", "LICENSE"],
    ["vite", "8.0.7", "MIT", "LICENSE"],
    ["vite-string-plugin", "2.0.2", "BSD-2-Clause", "LICENSE"],
    ["vue", "3.5.32", "MIT", "LICENSE"],
    ["vue-bar-graph", "2.2.0", "MIT", ""],
    ["vue-chartjs", "5.3.3", "MIT", "LICENSE"],
  ]);
});

test("findPkgRoot resolves package roots and returns null for invalid paths", () => {
  const roots: Record<string, string | null> = {
    "/x/node_modules/pkg/lib/foo.js": "/x/node_modules/pkg",
    "/x/node_modules/pkg/index.js": "/x/node_modules/pkg",
    "/x/node_modules/pkg": "/x/node_modules/pkg",
    "/x/node_modules/@scope/pkg/lib/foo.js": "/x/node_modules/@scope/pkg",
    "/x/node_modules/@scope/pkg": "/x/node_modules/@scope/pkg",
    "/x/node_modules/a/node_modules/b/lib/foo.js": "/x/node_modules/a/node_modules/b",
    "/x/node_modules/@s/a/node_modules/@t/b/foo.js": "/x/node_modules/@s/a/node_modules/@t/b",
    "/x/no-modules/foo.js": null,
    "/x/node_modules/@scope": null,
    "/x/node_modules/@": null,
    "": null,
  };
  expect(Object.fromEntries(Object.keys(roots).map((path) => [path, findPkgRoot(path)]))).toStrictEqual(roots);
});
