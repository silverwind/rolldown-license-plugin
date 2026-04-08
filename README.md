# rolldown-license-plugin

[![](https://img.shields.io/npm/v/rolldown-license-plugin.svg?style=flat)](https://www.npmjs.org/package/rolldown-license-plugin) [![](https://img.shields.io/npm/dm/rolldown-license-plugin.svg)](https://www.npmjs.org/package/rolldown-license-plugin) [![](https://depx.co/api/badge/rolldown-license-plugin)](https://depx.co/pkg/rolldown-license-plugin)

Rolldown plugin to extract dependency licenses.

## Usage

```js
import {licensePlugin} from "rolldown-license-plugin";

export default {
  plugins: [
    licensePlugin({
      done(licenses) {
        console.info(licenses);
        // => [{name, version, license, licenseText}]
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

#### `opts.wrapText`

Type: `number`

When set, word-wrap `licenseText` to this column width.

#### `opts.allow`

Type: `(license: LicenseInfo) => boolean`

Validate each dependency's license. Return `false` to reject it. By default, rejected dependencies are warned via `console.warn`. Use `failOnViolation` and `failOnUnlicensed` to throw build errors instead.

#### `opts.failOnViolation`

Type: `boolean`\
Default: `false`

Throw a build error when `allow` rejects a dependency that has a license.

#### `opts.failOnUnlicensed`

Type: `boolean`\
Default: `false`

Throw a build error when `allow` rejects a dependency that has no license.

### `LicenseInfo`

```typescript
type LicenseInfo = {
  name: string;        // package name
  version: string;     // package version
  license: string;     // SPDX license identifier from package.json
  licenseText: string; // contents of LICENSE/COPYING file, or ""
};
```

### `wrap(length)`

Function to word-wrap text to a certain column width.

## License

© [silverwind](https://github.com/silverwind), distributed under BSD-2-Clause.
