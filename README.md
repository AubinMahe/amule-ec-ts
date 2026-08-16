# amule-ec

[![CI](https://github.com/AubinMahe/amule-ec-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/AubinMahe/amule-ec-ts/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/AubinMahe/amule-ec-ts/graph/badge.svg)](https://codecov.io/gh/AubinMahe/amule-ec-ts)
[![npm](https://img.shields.io/npm/v/amule-ec.svg)](https://www.npmjs.com/package/amule-ec)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE.txt)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)

A from-scratch TypeScript client for [aMule](https://github.com/amule-org/amule)'s binary "External Connections" (EC) protocol - the
protocol `amuled` exposes for remote control (the same one `amulecmd`, `amuleweb` and the aMule GUI use).

Zero runtime dependencies - only Node built-ins (`node:net`, `node:crypto`, `node:zlib`, `node:events`, `node:util`,
`node:timers/promises`).

## Status

All 88 EC opcodes are wrapped. See [CHANGELOG.md](CHANGELOG.md) for release history and [TODO.md](TODO.md) for open items.

## Usage

```ts
import * as ec from "amule-ec";

const { port, passwordHash } = /* read from amuled's own amule.conf, [ExternalConnect] section */;

await ec.ECEngine.start({ host: "localhost", port, passwordHash });

const downloads = new ec.Downloads(ec.ECEngine.connection);
await downloads.fetch();
console.log(downloads.files);
```

`ECEngine` has no filesystem access of its own and no opinion on where `port`/`passwordHash` come from - reading `amule.conf` is the
caller's responsibility.

## Observability

Connection loss and failed reconnect attempts are always logged to stderr via `console.error`/`console.log` - no opt-in needed.
Everything else (wire framing, opcode dispatch, per-request results) is silent by default and opt-in per topic via Node's built-in
`NODE_DEBUG` env var, one topic per feature class, all under the `amule-ec:` prefix (e.g. `amule-ec:downloads`,
`amule-ec:preferences`).

```bash
NODE_DEBUG=amule-ec:downloads node app.js   # trace only Downloads
NODE_DEBUG=amule-ec:*         node app.js   # trace everything
```

## Development

```bash
npm install
npm run lint                     # tsc --noEmit + eslint
npm run build                    # emits dist/ (JS + .d.ts)
npm run test          # mocha
npm run test:coverage # mocha + v8 coverage report

# Interactive REPL against a real local amuled (reads ~/.aMule/amule.conf directly -
# the library itself never touches the filesystem, see ECEngine's doc)
npm run repl
# or via the VS Code launch config "repl" (tests/repl/main.ts), e.g. argv "show dl"
```

### Testing the package locally before publishing

```bash
npm run build
npm pack                         # produces amule-ec-<version>.tgz
```

Then, from another project:

```bash
npm install /path/to/amule-ec-<version>.tgz
```

This installs exactly what a real consumer would get from the npm registry (respecting `files`/`package.json`).

## Contributing

Bug reports and pull requests are welcome - see [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for the project's expectations of contributors.

## License

GPL-3.0-or-later. See [LICENSE.txt](LICENSE.txt).
