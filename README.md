# rolldown-license-plugin

[![](https://img.shields.io/npm/v/rolldown-license-plugin.svg?style=flat)](https://www.npmjs.org/package/rolldown-license-plugin) [![](https://img.shields.io/npm/dm/rolldown-license-plugin.svg)](https://www.npmjs.org/package/rolldown-license-plugin) [![](https://depx.co/api/badge/rolldown-license-plugin)](https://depx.co/pkg/rolldown-license-plugin)

Rolldown plugin to extract dependency licenses and optionally validate them. Zero dependencies, optimized for performance.

## Usage

```js
import {licensePlugin} from "rolldown-license-plugin";

export default {
  plugins: [
    licensePlugin({
      done(deps, context) {
        const content = deps.map(({name, version, license, licenseText}) => (
          `${name} ${version} (${license})\n${licenseText}`
        )).join("\n\n");
        context.emitFile({
          type: "asset",
          fileName: "licenses.txt",
          source: content,
        });
      },
    }),
  ],
};
```

## API

### `licensePlugin(opts)`

Returns the plugin.

#### `opts.done`

Type: `(licenses: LicenseInfo[], context: PluginContext) => void | Promise<void>`

Callback invoked during `generateBundle` with the collected license data. The `context` parameter provides access to rolldown's plugin context, including `emitFile`.

#### `opts.match`

Type: `RegExp`\
Default: `/^((UN)?LICEN(S|C)E|COPYING).*$/i`

Regex to match license filenames in package directories.

#### `opts.wrapLicenseText`

Type: `number`

When set, word-wrap `licenseText` to this column width.

#### `opts.allow`

Type: `(license: LicenseInfo) => boolean`

Validate each dependency's license. Return `false` to reject it. By default, rejected dependencies are warned via `console.warn`. Use `failOnViolation` and `failOnUnlicensed` to throw build errors instead.

#### `opts.failOnViolation`

Type: `boolean`\
Default: `false`

Throw a build error when a dependency has an incompatible license.

#### `opts.failOnUnlicensed`

Type: `boolean`\
Default: `false`

Throw a build error when a dependency does not specify any license.

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

Function to word-wrap `text` to a certain column `width`. Returns the wrapped string.

## License

© [silverwind](https://github.com/silverwind), distributed under BSD-2-Clause.
