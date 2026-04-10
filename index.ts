import {readFile, readdir} from "node:fs/promises";
import {join} from "node:path";

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
  /** Validate each dependency's license. Return `false` to reject it */
  allow?: (license: LicenseInfo) => boolean;
  /** Throw a build error when a dependency has an incompatible license. Default: `false` (warn only) */
  failOnViolation?: boolean;
  /** Throw a build error when a dependency does not specify any license. Default: `false` (warn only) */
  failOnUnlicensed?: boolean;
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

const nmSep = "/node_modules/";

/** Resolve the package root directory from a file path inside node_modules */
function findPkgRoot(fsPath: string): string | null {
  const nmIdx = fsPath.lastIndexOf(nmSep);
  if (nmIdx === -1) return null;
  const base = nmIdx + nmSep.length;
  const rest = fsPath.slice(base);
  if (rest.startsWith("@")) {
    const firstSlash = rest.indexOf("/");
    if (firstSlash === -1) return null;
    const secondSlash = rest.indexOf("/", firstSlash + 1);
    return fsPath.slice(0, base) + rest.slice(0, secondSlash === -1 ? rest.length : secondSlash);
  }
  const firstSlash = rest.indexOf("/");
  return fsPath.slice(0, base) + rest.slice(0, firstSlash === -1 ? rest.length : firstSlash);
}

/** Rolldown plugin that extracts license information from bundled dependencies */
export const licensePlugin = ({done, match = defaultMatch, wrapText, allow, failOnViolation = false, failOnUnlicensed = false}: RolldownLicensePluginOpts): Plugin => ({
  name: "rolldown-license-plugin",
  async generateBundle(_opts, bundle) {
    const roots = new Set<string>();
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== "chunk") continue;
      for (const moduleId of Object.keys(chunk.modules)) {
        const qIdx = moduleId.indexOf("?");
        const root = findPkgRoot(qIdx === -1 ? moduleId : moduleId.slice(0, qIdx));
        if (root) roots.add(root);
      }
    }

    const seen = new Set<string>();
    const licenses: LicenseInfo[] = [];

    await Promise.all(Array.from(roots, async (dir) => {
      let pkgJson: PkgJson;
      try {
        pkgJson = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as PkgJson;
      } catch { return; }
      if (!pkgJson.name) return;
      const key = `${pkgJson.name}@${pkgJson.version ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);

      let licenseText = "";
      try {
        const files = await readdir(dir);
        const licenseFile = files.find((entry) => match.test(entry));
        if (licenseFile) {
          licenseText = await readFile(join(dir, licenseFile), "utf8");
          if (wrapText) licenseText = wrap(licenseText, wrapText).trim();
        }
      } catch {}

      licenses.push({
        name: pkgJson.name,
        version: pkgJson.version ?? "",
        license: parseLicense(pkgJson),
        licenseText,
      });
    }));

    licenses.sort((a, b) => a.name.localeCompare(b.name));

    if (allow) {
      const errors: string[] = [];
      for (const entry of licenses) {
        if (allow(entry)) continue;
        const fail = entry.license ? failOnViolation : failOnUnlicensed;
        const msg = entry.license ?
          `Dependency "${entry.name}" has an incompatible license: ${entry.license}` :
          `Dependency "${entry.name}" does not specify any license.`;
        if (fail) errors.push(msg); else console.warn(msg);
      }
      if (errors.length) {
        throw new Error(errors.join("\n"));
      }
    }

    await done(licenses, this);
  },
});
