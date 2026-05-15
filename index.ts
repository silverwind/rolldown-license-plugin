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

const emptyText = Promise.resolve("");

/** Word-wrap plain text to a specified column width */
export function wrap(text: string, width: number): string {
  const lines: string[] = [];
  for (const rawLine of text.replace(/\r/g, "").split("\n")) {
    const line = rawLine.replace(/\t/g, (_tab, offset) => " ".repeat(8 - (offset % 8))).trimEnd();
    if (line.length <= width) {
      lines.push(line);
      continue;
    }
    let pos = 0;
    while (pos < line.length) {
      if (pos + width >= line.length) {
        lines.push(line.slice(pos).trimEnd());
        break;
      }
      let breakAt = line.lastIndexOf(" ", pos + width);
      if (breakAt <= pos) {
        breakAt = line.indexOf(" ", pos + width);
        if (breakAt === -1) {
          lines.push(line.slice(pos).trimEnd());
          break;
        }
      }
      lines.push(line.slice(pos, breakAt).trimEnd());
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

    // Dedup by name@version before reading license files: pnpm and nested
    // node_modules can surface the same package at multiple paths.
    const dirs = Array.from(roots);
    const [pkgRaws, dirEntries] = await Promise.all([
      Promise.all(dirs.map((dir) => readFile(join(dir, "package.json"), "utf8").catch(() => null))),
      Promise.all(dirs.map((dir) => readdir(dir).catch(() => null))),
    ]);

    const seen = new Set<string>();
    const unique: {dir: string, pkgJson: PkgJson, licenseFile?: string}[] = [];
    for (let i = 0; i < dirs.length; i++) {
      const pkgRaw = pkgRaws[i];
      if (pkgRaw === null) continue;
      let pkgJson: PkgJson;
      try { pkgJson = JSON.parse(pkgRaw) as PkgJson; } catch { continue; }
      if (!pkgJson.name) continue;
      const key = `${pkgJson.name}@${pkgJson.version ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({
        dir: dirs[i],
        pkgJson,
        licenseFile: dirEntries[i]?.find((entry) => match.test(entry)),
      });
    }

    const licenseTexts = await Promise.all(unique.map(({dir, licenseFile}) =>
      licenseFile ? readFile(join(dir, licenseFile), "utf8").catch(() => "") : emptyText,
    ));

    const licenses: LicenseInfo[] = unique.map(({pkgJson}, i) => {
      const raw = licenseTexts[i];
      return {
        name: pkgJson.name!,
        version: pkgJson.version ?? "",
        license: parseLicense(pkgJson),
        licenseText: wrapLicenseText && raw ? wrap(raw, wrapLicenseText).trim() : raw,
      };
    });

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
