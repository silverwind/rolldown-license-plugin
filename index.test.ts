import {join} from "node:path";
import {build} from "rolldown";
import {licensePlugin} from "./index.ts";

import type {LicenseInfo} from "./index.ts";

const fixturesDir = join(import.meta.dirname, "fixtures");

function buildWithPlugin(opts: Partial<Parameters<typeof licensePlugin>[0]> = {}) {
  return build({
    input: join(fixturesDir, "entry.js"),
    resolve: {
      modules: [join(fixturesDir, "node_modules")],
    },
    write: false,
    plugins: [licensePlugin({onDone() {}, ...opts})],
  });
}

test("collects licenses from bundled dependencies", async () => {
  let result: LicenseInfo[] = [];
  await buildWithPlugin({onDone(licenses) { result = licenses; }});

  expect(result).toHaveLength(4);

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
});

test("wrapText wraps license text to specified width", async () => {
  let result: LicenseInfo[] = [];
  await buildWithPlugin({onDone(licenses) { result = licenses; }, wrapText: 80});

  const pkg = result.find((entry) => entry.name === "test-pkg-a")!;
  for (const line of pkg.licenseText.split("\n")) {
    expect(line.length).toBeLessThanOrEqual(80);
  }
  expect(pkg.licenseText).toContain("MIT License");
  expect(pkg.licenseText).toContain("\n");
});

test("wrapText preserves blank lines", async () => {
  let result: LicenseInfo[] = [];
  await buildWithPlugin({onDone(licenses) { result = licenses; }, wrapText: 80});

  const pkg = result.find((entry) => entry.name === "test-pkg-a")!;
  expect(pkg.licenseText).toContain("\n\n");
});

test("allow throws on license violation", async () => {
  await expect(buildWithPlugin({
    allow: (dep) => dep.license === "MIT",
  })).rejects.toThrow("License violation");
});

test("allow passes when all licenses match", async () => {
  let result: LicenseInfo[] = [];
  await buildWithPlugin({
    onDone(licenses) { result = licenses; },
    allow: (dep) => /MIT|ISC|Apache/.test(dep.license),
  });
  expect(result).toHaveLength(4);
});
