import {readFile, readdir} from "node:fs/promises";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";

import type {Plugin} from "rolldown";

const defaultMatch = /^((UN)?LICEN(S|C)E|COPYING).*$/i;

export type LicenseInfo = {
  name: string;
  version: string;
  license: string;
  licenseText: string;
};

export type RolldownLicensePluginOpts = {
  onDone: (licenses: LicenseInfo[]) => void;
  match?: RegExp;
};

type PkgJsonLicense = string | {type?: string};
type PkgJson = {name?: string, version?: string, license?: PkgJsonLicense, licenses?: PkgJsonLicense[]};

function parseLicense(pkgJson: PkgJson): string {
  if (typeof pkgJson.license === "string") return pkgJson.license;
  if (pkgJson.license?.type) return pkgJson.license.type;
  if (Array.isArray(pkgJson.licenses)) {
    return pkgJson.licenses
      .map((entry) => typeof entry === "string" ? entry : entry?.type ?? "")
      .filter(Boolean)
      .join(" OR ");
  }
  return "";
}

export const licensePlugin = ({onDone, match = defaultMatch}: RolldownLicensePluginOpts): Plugin => ({
  name: "rolldown-license-plugin",
  async generateBundle(_opts, bundle) {
    const pkgJsonCache = new Map<string, PkgJson | null>();
    const pkgDirs = new Map<string, {dir: string, pkgJson: PkgJson}>();

    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== "chunk") continue;
      for (const moduleId of Object.keys(chunk.modules)) {
        const fsPath = moduleId.split("?")[0];
        if (!fsPath.includes("node_modules")) continue;
        let dir = dirname(fsPath);
        const cached = pkgJsonCache.get(dir);
        if (cached !== undefined) {
          if (cached?.name) {
            const key = `${cached.name}@${cached.version ?? ""}`;
            if (!pkgDirs.has(key)) pkgDirs.set(key, {dir, pkgJson: cached});
          }
          continue;
        }
        let pkgJson: PkgJson | null = null;
        const walked: string[] = [];
        while (dir !== dirname(dir) && dir.includes("node_modules")) {
          const cachedInner = pkgJsonCache.get(dir);
          if (cachedInner !== undefined) {
            pkgJson = cachedInner;
            break;
          }
          walked.push(dir);
          try {
            pkgJson = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PkgJson;
          } catch {
            pkgJson = null;
          }
          if (pkgJson?.name) break;
          pkgJson = null;
          dir = dirname(dir);
        }
        for (const walkedDir of walked) pkgJsonCache.set(walkedDir, pkgJson);
        if (!pkgJson?.name) continue;
        const key = `${pkgJson.name}@${pkgJson.version ?? ""}`;
        if (!pkgDirs.has(key)) pkgDirs.set(key, {dir, pkgJson});
      }
    }

    const licenses = await Promise.all(Array.from(pkgDirs.values(), async ({dir, pkgJson}) => {
      let licenseText = "";
      try {
        const files = await readdir(dir);
        const licenseFile = files.find((entry) => match.test(entry));
        if (licenseFile) licenseText = await readFile(join(dir, licenseFile), "utf8");
      } catch {}
      return {
        name: pkgJson.name!,
        version: pkgJson.version ?? "",
        license: parseLicense(pkgJson),
        licenseText,
      };
    }));

    licenses.sort((a, b) => a.name.localeCompare(b.name));
    onDone(licenses);
  },
});
