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
    plugins: [licensePlugin({done() {}, ...opts})],
  });
}

test("collects licenses from bundled dependencies", async () => {
  let result: LicenseInfo[] = [];
  await buildWithPlugin({done(licenses) { result = licenses; }});

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

test("wrapText wraps license text to specified width", async () => {
  let result: LicenseInfo[] = [];
  await buildWithPlugin({done(licenses) { result = licenses; }, wrapText: 80});

  const pkg = result.find((entry) => entry.name === "test-pkg-a")!;
  for (const line of pkg.licenseText.split("\n")) {
    expect(line.length).toBeLessThanOrEqual(80);
  }
  expect(pkg.licenseText).toContain("MIT License");
  expect(pkg.licenseText).toContain("\n");
});

test("wrapText preserves blank lines", async () => {
  let result: LicenseInfo[] = [];
  await buildWithPlugin({done(licenses) { result = licenses; }, wrapText: 80});

  const pkg = result.find((entry) => entry.name === "test-pkg-a")!;
  expect(pkg.licenseText).toContain("\n\n");
});

test("allow warns by default without failing", async () => {
  let result: LicenseInfo[] = [];
  await buildWithPlugin({
    done(licenses) { result = licenses; },
    allow: (dep) => dep.license === "MIT",
  });
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
  let result: LicenseInfo[] = [];
  await buildWithPlugin({
    done(licenses) { result = licenses; },
    allow: (dep) => Boolean(dep.license),
    failOnViolation: true,
  });
  expect(result).toHaveLength(5);
});

test("failOnUnlicensed does not throw for license mismatch", async () => {
  let result: LicenseInfo[] = [];
  await buildWithPlugin({
    done(licenses) { result = licenses; },
    allow: (dep) => !dep.license || dep.license === "MIT",
    failOnUnlicensed: true,
  });
  expect(result).toHaveLength(5);
});

test("allow passes when all licenses match", async () => {
  let result: LicenseInfo[] = [];
  await buildWithPlugin({
    done(licenses) { result = licenses; },
    allow: () => true,
  });
  expect(result).toHaveLength(5);
});
