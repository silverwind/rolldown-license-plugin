# rolldown-license-plugin

[![](https://img.shields.io/npm/v/rolldown-license-plugin.svg?style=flat)](https://www.npmjs.org/package/rolldown-license-plugin) [![](https://img.shields.io/npm/dm/rolldown-license-plugin.svg)](https://www.npmjs.org/package/rolldown-license-plugin)

Rolldown plugin to extract dependency licenses from bundled `node_modules`. Zero dependencies, and will always stay that way.

## Installation

```console
npm i rolldown-license-plugin
```

## Usage

```js
import {licensePlugin} from "rolldown-license-plugin";

export default {
  plugins: [
    licensePlugin({
      onDone(licenses) {
        // licenses is an array of {name, version, license, licenseText}
        console.info(licenses);
      },
    }),
  ],
};
```

## API

### `licensePlugin(opts)`

Returns a Rolldown plugin.

#### `opts.onDone`

Type: `(licenses: LicenseInfo[]) => void`

Callback invoked during `generateBundle` with the collected license data.

#### `opts.match`

Type: `RegExp`\
Default: `/^((UN)?LICEN(S|C)E|COPYING).*$/i`

Regex to match license filenames in package directories.

### `LicenseInfo`

```typescript
type LicenseInfo = {
  name: string;        // package name
  version: string;     // package version
  license: string;     // SPDX license identifier from package.json
  licenseText: string; // contents of LICENSE/COPYING file, or ""
};
```

## License

© [silverwind](https://github.com/silverwind), distributed under BSD-2-Clause.
