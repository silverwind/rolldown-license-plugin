import {readFile, readdir} from "node:fs/promises";
import {join, sep} from "node:path";
import type {Plugin, PluginContext} from "rolldown";

export const defaultMatch = /^((UN)?LICEN(S|C)E|COPYING).*$/i;

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
  wrapLicenseText?: number;
  /** Validate each dependency's license. Return `false` to reject it */
  allow?: (license: LicenseInfo) => boolean;
  /** Throw a build error when a dependency has an incompatible license. Default: `false` (warn only) */
  failOnViolation?: boolean;
  /** Throw a build error when a dependency does not specify any license. Default: `false` (warn only) */
  failOnUnlicensed?: boolean;
};

type PkgJsonLicense = string | {type?: string};
type PkgJson = {name?: string, version?: string, license?: PkgJsonLicense, licenses?: PkgJsonLicense[]};
type Pending = {pkgJson: PkgJson, licenseRead: Promise<string>};

const emptyText = Promise.resolve("");

/** Word-wrap plain text to a specified column width */
export function wrap(text: string, width: number): string {
  const lines: string[] = [];
  for (const rawLine of text.replace(/\r/g, "").split("\n")) {
    const inputLine = rawLine.replace(/\t/g, (_tab, offset) => " ".repeat(8 - (offset % 8)));
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
const needsPathNormalize = sep !== "/";
/** Resolve the package root directory from a file path inside node_modules */
export function findPkgRoot(fsPath: string): string | null {
  const normalized = needsPathNormalize ? fsPath.replaceAll(sep, "/") : fsPath;
  const nmIdx = normalized.lastIndexOf(nmSep);
  if (nmIdx === -1) return null;
  const base = nmIdx + nmSep.length;
  const firstSlash = normalized.indexOf("/", base);
  if (normalized.startsWith("@", base)) {
    if (firstSlash === -1) return null;
    const secondSlash = normalized.indexOf("/", firstSlash + 1);
    return secondSlash === -1 ? normalized : normalized.slice(0, secondSlash);
  }
  return firstSlash === -1 ? normalized : normalized.slice(0, firstSlash);
}

/** Rolldown plugin that extracts license information from bundled dependencies */
export const licensePlugin = ({done, match = defaultMatch, wrapLicenseText, allow, failOnViolation = false, failOnUnlicensed = false}: RolldownLicensePluginOpts): Plugin => ({
  name: "rolldown-license-plugin",
  async generateBundle(_opts, bundle) {
    const roots = new Set<string>();
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== "chunk") continue;
      for (const moduleId of Object.keys(chunk.modules)) {
        if (moduleId[0] === "\0") continue;
        const qIdx = moduleId.indexOf("?");
        const root = findPkgRoot(qIdx === -1 ? moduleId : moduleId.slice(0, qIdx));
        if (root) roots.add(root);
      }
    }

    // Two-phase batched IO: kick off all package.json + readdir calls together, then
    // all license-file reads together. Avoids per-package async overhead and gives the
    // libuv thread pool uniform batches to chew through.
    const dirs = Array.from(roots);
    const [pkgRaws, dirEntries] = await Promise.all([
      Promise.all(dirs.map((dir) => readFile(join(dir, "package.json"), "utf8").catch(() => null))),
      Promise.all(dirs.map((dir) => readdir(dir).catch(() => null))),
    ]);

    const pending = dirs.map((dir, i): Pending | null => {
      const pkgRaw = pkgRaws[i];
      if (pkgRaw === null) return null;
      let pkgJson: PkgJson;
      try { pkgJson = JSON.parse(pkgRaw) as PkgJson; } catch { return null; }
      if (!pkgJson.name) return null;
      const licenseFile = dirEntries[i]?.find((entry) => match.test(entry));
      return {
        pkgJson,
        licenseRead: licenseFile ?
          readFile(join(dir, licenseFile), "utf8").catch(() => "") :
          emptyText,
      };
    });

    const licenseTexts = await Promise.all(pending.map((p) => p?.licenseRead ?? emptyText));

    const seen = new Set<string>();
    const licenses: LicenseInfo[] = [];
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      if (!p) continue;
      const {pkgJson} = p;
      const version = pkgJson.version ?? "";
      const key = `${pkgJson.name}@${version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const raw = licenseTexts[i];
      const licenseText = wrapLicenseText && raw ? wrap(raw, wrapLicenseText).trim() : raw;
      licenses.push({
        name: pkgJson.name!,
        version,
        license: parseLicense(pkgJson),
        licenseText,
      });
    }

    licenses.sort((a, b) => a.name.localeCompare(b.name));

    if (allow) {
      const errors: string[] = [];
      for (const entry of licenses) {
        if (allow(entry)) continue;
        const fail = entry.license ? failOnViolation : failOnUnlicensed;
        const msg = entry.license ?
          `Dependency "${entry.name}" has an incompatible license: ${entry.license}` :
          `Dependency "${entry.name}" does not specify any license.`;
        if (fail) errors.push(msg);
        else this.warn(msg);
      }
      if (errors.length) this.error(errors.join("\n"));
    }

    await done(licenses, this);
  },
});
