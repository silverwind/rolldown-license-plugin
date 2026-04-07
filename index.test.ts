import {join} from "node:path";
import {build} from "rolldown";
import {licensePlugin} from "./index.ts";

import type {LicenseInfo} from "./index.ts";

const fixturesDir = join(import.meta.dirname, "fixtures");

function buildWithPlugin(onDone: (licenses: LicenseInfo[]) => void) {
  return build({
    input: join(fixturesDir, "entry.js"),
    resolve: {
      modules: [join(fixturesDir, "node_modules")],
    },
    write: false,
    plugins: [licensePlugin({onDone})],
  });
}

test("collects licenses from bundled dependencies", async () => {
  let result: LicenseInfo[] = [];
  await buildWithPlugin((licenses) => { result = licenses; });

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
