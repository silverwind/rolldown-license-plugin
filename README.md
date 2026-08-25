# rolldown-license-plugin

[![](https://img.shields.io/npm/v/rolldown-license-plugin.svg?style=flat)](https://www.npmjs.org/package/rolldown-license-plugin) [![](https://img.shields.io/npm/dm/rolldown-license-plugin.svg)](https://www.npmjs.org/package/rolldown-license-plugin) [![](https://packagephobia.com/badge?p=rolldown-license-plugin)](https://packagephobia.com/result?p=rolldown-license-plugin) [![](https://depx.co/api/badge/rolldown-license-plugin)](https://depx.co/pkg/rolldown-license-plugin)

Rolldown/Vite plugin to extract dependency licenses and optionally validate them. Zero dependencies, optimized for performance.

## Usage

```js
import {defineConfig} from "rolldown";
import {licensePlugin} from "rolldown-license-plugin";

export default defineConfig({
  plugins: [
    licensePlugin({
      done(deps, context) {
        context.emitFile({
          type: "asset",
          fileName: "licenses.txt",
          source: deps.map(({name, version, license, licenseText}) => {
            return `${name}@${version} - ${license}\n${licenseText}`;
          }).join("\n\n"),
        });
      },
    }),
  ],
});
```

For Vite, import `defineConfig` from `vite` instead of `rolldown`. Everything else is identical.

## API

### `licensePlugin(opts)`

- `done: (licenses: LicenseInfo[], context: PluginContext) => void | Promise<void>`\
  Invoked during `generateBundle` with the collected licenses. `context` is rolldown's plugin context, including `emitFile`.
- `match: RegExp`, default `/^((UN)?LICEN(S|C)E|COPYING).*$/i`\
  Matches license filenames in package directories.
- `wrapLicenseText?: number`\
  Word-wrap `licenseText` to this column width.
- `allow?: (license: LicenseInfo) => boolean`\
  Return `false` to reject a dependency. Rejections warn via the plugin context unless a `failOn*` option is set.
- `failOnViolation?: boolean`, default `false`\
  Throw instead of warning when `allow` rejects a dependency that has a license.
- `failOnUnlicensed?: boolean`, default `false`\
  Throw instead of warning when `allow` rejects a dependency that has no license.

### `LicenseInfo`

```typescript
type LicenseInfo = {
  name: string;        // package name
  version: string;     // package version, or ""
  license: string;     // SPDX license identifier from package.json, or ""
  licenseText: string; // contents of LICENSE/COPYING file, or ""
};
```

### `wrap(text, width)`

Word-wraps `text` to column `width`, returns the wrapped string.

## License

© [silverwind](https://github.com/silverwind), distributed under BSD-2-Clause.
