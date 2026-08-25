import {readFile, readdir} from "node:fs/promises";
import {sep} from "node:path";
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
type Pkg = {dir: string, name: string, version: string, license: string};

/** Word-wrap plain text to a specified column width */
export function wrap(text: string, width: number): string {
  if (width < 0) throw new RangeError(`wrap: width must not be negative, got ${width}`); // negative width never advances `pos`
  const lines: string[] = [];
  for (const rawLine of text.replace(/\r/g, "").split("\n")) {
    // `shift` tracks the columns added by previous tabs so every tab stops on a multiple of 8
    let shift = 0;
    const line = (rawLine.includes("\t") ? rawLine.replace(/\t/g, (_tab, offset) => {
      const spaces = 8 - ((offset + shift) % 8);
      shift += spaces - 1;
      return " ".repeat(spaces);
    }) : rawLine).trimEnd();
    let pos = 0;
    while (line.length - pos > width) {
      let breakAt = line.lastIndexOf(" ", pos + width);
      if (breakAt <= pos) {
        breakAt = line.indexOf(" ", pos + width);
        if (breakAt === -1) break; // single word longer than the remaining width
      }
      const segment = line.slice(pos, breakAt).trimEnd();
      if (segment) lines.push(segment); // an all-space segment is a break inside an indent run, not a blank line
      pos = breakAt + 1;
    }
    lines.push(line.slice(pos).trimEnd());
  }
  return lines.join("\n");
}

/**
 * Retry while the process is out of descriptors. libuv queues opens FIFO, so reading every package at
 * once holds one fd per package and hits EMFILE under a low limit, which would silently drop packages.
 * Retrying beats bounding concurrency, which costs ~20% on trees that never run out.
 */
async function retryEmfile<Result>(fn: () => Promise<Result>): Promise<Result> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const {code} = err as NodeJS.ErrnoException;
      if ((code !== "EMFILE" && code !== "ENFILE") || attempt >= 10) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt));
    }
  }
}

/** Read a file, returning an empty string when it is missing or unreadable */
async function readText(path: string): Promise<string> {
  try {
    return await retryEmfile(() => readFile(path, "utf8"));
  } catch {
    return "";
  }
}

/** List a directory, returning an empty array when it is missing or unreadable */
async function readEntries(dir: string): Promise<string[]> {
  try {
    return await retryEmfile(() => readdir(dir));
  } catch {
    return [];
  }
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
export function findPkgRoot(fsPath: string): string | null {
  const normalized = sep === "/" ? fsPath : fsPath.replaceAll(sep, "/");
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
    // `g` and `y` make `test` stateful across calls, which would skip matches. Clone rather than
    // strip the flags, since dropping `y` also drops its anchoring and silently widens the match.
    const cloned = new RegExp(match.source, match.flags);
    const matches = (name: string) => {
      cloned.lastIndex = 0;
      return cloned.test(name);
    };

    const roots = new Set<string>();
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== "chunk") continue;
      for (const moduleId of Object.keys(chunk.modules)) {
        if (moduleId[0] === "\0") continue;
        // a query may embed a path, so strip it, but not when that loses the marker and the `?` was a parent dir
        const qIdx = moduleId.indexOf("?");
        const stripped = qIdx === -1 ? moduleId : moduleId.slice(0, qIdx);
        const root = findPkgRoot(stripped.includes("node_modules") ? stripped : moduleId);
        if (root) roots.add(root);
      }
    }

    // findPkgRoot returns forward-slash paths, so concat is cross-platform-safe and avoids path.join overhead.
    const parsed = await Promise.all(Array.from(roots, async (dir) => {
      try {
        const pkgJson = JSON.parse(await retryEmfile(() => readFile(`${dir}/package.json`, "utf8"))) as PkgJson;
        if (!pkgJson.name) return null;
        return {dir, name: pkgJson.name, version: pkgJson.version ?? "", license: parseLicense(pkgJson)};
      } catch {
        return null; // missing, unreadable or malformed package.json
      }
    }));

    // Dedup before readdir/readFile: npm nesting and pnpm peer variants surface the same package at
    // multiple paths. The license is part of the key so two different packages sharing a name@version
    // both reach `allow`, rather than one silently winning the compliance check.
    const pkgs = new Map<string, Pkg>();
    for (const pkg of parsed) {
      if (!pkg) continue;
      const key = `${pkg.name}@${pkg.version}\0${pkg.license}`;
      if (!pkgs.has(key)) pkgs.set(key, pkg);
    }

    // Fast path: most packages name their license file exactly "LICENSE", so try that before readdir.
    const probeDirect = matches("LICENSE");
    const licenses: LicenseInfo[] = await Promise.all(Array.from(pkgs.values(), async ({dir, name, version, license}) => {
      let raw = probeDirect ? await readText(`${dir}/LICENSE`) : "";
      if (!raw) {
        for (const entry of await readEntries(dir)) {
          if (!matches(entry)) continue;
          raw = await readText(`${dir}/${entry}`); // a matching directory reads as "", so keep trying
          if (raw) break;
        }
      }
      return {
        name,
        version,
        license,
        licenseText: wrapLicenseText && raw ? wrap(raw, wrapLicenseText).trim() : raw,
      };
    }));

    licenses.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version) || a.license.localeCompare(b.license));

    if (allow) {
      const errors: string[] = [];
      for (const entry of licenses) {
        if (allow(entry)) continue;
        const unlicensed = !entry.license;
        const msg = unlicensed ?
          `Dependency "${entry.name}" does not specify any license.` :
          `Dependency "${entry.name}" has an incompatible license: ${entry.license}`;
        if (unlicensed ? failOnUnlicensed : failOnViolation) errors.push(msg);
        else this.warn(msg);
      }
      if (errors.length) this.error(errors.join("\n"));
    }

    await done(licenses, this);
  },
});
