import {readFile, readdir} from "node:fs/promises";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";

import type {Plugin, PluginContext} from "rolldown";

const defaultMatch = /^((UN)?LICEN(S|C)E|COPYING).*$/i;

/** License information for a single bundled dependency */
export type LicenseInfo = {
  /** Package name from package.json */
  name: string;
  /** Package version from package.json */
  version: string;
  /** SPDX license identifier from package.json */
  license: string;
  /** Contents of the LICENSE/COPYING file, or empty string if not found */
  licenseText: string;
};

/** Options for {@link licensePlugin} */
export type RolldownLicensePluginOpts = {
  /** Called during `generateBundle` with the collected license data, sorted by name */
  done: (licenses: LicenseInfo[], context: PluginContext) => void | Promise<void>;
  /** Regex to match license filenames. Default: `/^((UN)?LICEN(S|C)E|COPYING).*$/i` */
  match?: RegExp;
  /** When set, word-wrap `licenseText` to this column width */
  wrapText?: number;
  /** Validate each dependency's license. Return `false` to throw a build error */
  allow?: (license: LicenseInfo) => boolean;
};

type PkgJsonLicense = string | {type?: string};
type PkgJson = {name?: string, version?: string, license?: PkgJsonLicense, licenses?: PkgJsonLicense[]};

/** Word-wrap plain text to a specified column width */
export function wrap(text: string, width: number): string {
  const lines: string[] = [];
  for (const rawLine of text.replace(/\r/g, "").split("\n")) {
    const inputLine = rawLine.replace(/\t/g, (_, offset) => " ".repeat(8 - (offset % 8)));
    const trimmed = inputLine.trim();
    if (trimmed.length <= width) {
      lines.push(trimmed);
      continue;
    }
    let pos = 0;
    while (pos < trimmed.length) {
      if (pos + width >= trimmed.length) {
        lines.push(trimmed.slice(pos).trim());
        break;
      }
      let breakAt = trimmed.lastIndexOf(" ", pos + width);
      if (breakAt <= pos) {
        breakAt = trimmed.indexOf(" ", pos + width);
        if (breakAt === -1) {
          lines.push(trimmed.slice(pos).trim());
          break;
        }
      }
      lines.push(trimmed.slice(pos, breakAt).trimEnd());
      pos = breakAt + 1;
    }
  }
  return lines.join("\n");
}

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

/** Rolldown plugin that extracts license information from bundled dependencies */
export const licensePlugin = ({done, match = defaultMatch, wrapText, allow}: RolldownLicensePluginOpts): Plugin => ({
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
        if (licenseFile) {
          licenseText = await readFile(join(dir, licenseFile), "utf8");
          if (wrapText) licenseText = wrap(licenseText, wrapText).trim();
        }
      } catch {}
      return {
        name: pkgJson.name!,
        version: pkgJson.version ?? "",
        license: parseLicense(pkgJson),
        licenseText,
      };
    }));

    licenses.sort((a, b) => a.name.localeCompare(b.name));

    if (allow) {
      const violations = licenses.filter((entry) => !allow(entry));
      if (violations.length) {
        throw new Error(`License violation in: ${violations.map((entry) => `${entry.name}@${entry.version} (${entry.license || "unlicensed"})`).join(", ")}`);
      }
    }

    await done(licenses, this);
  },
});
