# amule-ec

A from-scratch TypeScript client for aMule's binary "External Connections" (EC)
protocol - the protocol `amuled` exposes for remote control (the same one
`amulecmd`, `amuleweb` and the aMule GUI use).

Zero runtime dependencies - only Node built-ins (`node:net`, `node:crypto`,
`node:zlib`, `node:events`, `node:util`, `node:timers/promises`).

Extracted from [aMuleNodeJS](https://github.com/AubinMahe/aMuleNodeJS), a
personal home-server project, where protocol assumptions (opcodes, tag
layouts, enum values) were verified against aMule's own C++ source rather
than its EC protocol PDF doc, which has repeatedly proven incomplete or wrong
on non-trivial points.

## Status

Early extraction (`0.1.0`) - the API surface still mirrors its origin
project closely and hasn't yet been reviewed for a standalone library's
needs (versioning, changelog, semver commitments).

## Usage

```ts
import * as ec from "amule-ec";

const { port, passwordHash } = /* read from amuled's own amule.conf, [ExternalConnect] section */;

await ec.ECEngine.start({ host: "localhost", port, passwordHash });

const downloads = new ec.Downloads(ec.ECEngine.connection);
await downloads.fetch();
console.log(downloads.files);
```

`ECEngine` has no filesystem access of its own and no opinion on where
`port`/`passwordHash` come from - reading `amule.conf` is the caller's
responsibility.

## Development

```bash
npm install
npm run lint                     # tsc --noEmit + eslint
npm run build                    # emits dist/ (JS + .d.ts)
npm run tests-unitaires          # mocha
npm run tests-unitaires:coverage # mocha + v8 coverage report

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

This installs exactly what a real consumer would get from the npm registry
(respecting `files`/`package.json`), unlike `npm link` or a `file:` dependency
which expose the raw source tree instead.

## License

GPL-3.0-or-later. See [LICENSE.txt](LICENSE.txt).
