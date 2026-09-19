# Contributing

Thanks for considering a contribution to `amule-ec`. This is a small, zero-dependency library, so the bar for adding dependencies or
abstractions is high - when in doubt, open an issue to discuss the approach before sending a pull request.

## Setup

```bash
npm install
```

## Development loop

```bash
npm run lint                     # tsc --noEmit + eslint, must pass before opening a PR
npm run build                    # emits dist/ (JS + .d.ts)
npm run test          # mocha
npm run test:coverage # mocha + v8 coverage report
npm run lint:ts-fix              # prettier --write on src/ and tests/
```

`npm run repl` starts an interactive REPL (`tests/repl/main.ts`) against a real local `amuled`, reading `~/.aMule/amule.conf`
directly - useful for verifying protocol assumptions against a live daemon rather than only the mocked `fakeEcServer` used by the
unit tests.

## Protocol changes

Opcodes, tag layouts and enum values must be verified against aMule's own C++ source, not the EC protocol PDF doc - it has
repeatedly proven incomplete or wrong on non-trivial points. If a change touches wire format or opcode handling, say in the PR
description which C++ source file(s) you checked.

## Before opening a pull request

- `npm run lint` and `npm run test` both pass.
- New behavior has unit tests (see `tests/*.test.ts` and `tests/fakeEcServer.ts` for the mocking pattern already in use).
- Public API changes are reflected in `README.md`'s usage example if relevant.

## Releasing

`package-lock.json` is tracked (CI runs `npm ci`, which pins the dev toolchain with integrity hashes), and carries the package's own
version in two places, which `npm install` does not update unless asked. A version bump is one commit containing all of:

1. `package.json`: the new `version`.
2. `package-lock.json`: regenerated with `npm install --package-lock-only`.
3. `CHANGELOG.md`: the `[Unreleased]` entries moved under a dated `[x.y.z]` heading.

`npm run check-versions` verifies that `package.json` and `package-lock.json` agree; CI runs it on every push and pull request. Once
the bump is merged, push the tag `vX.Y.Z`: the release workflow runs the same check with the tag as argument
(`npm run check-versions -- vX.Y.Z`) and stops if the tag, `package.json` and `package-lock.json` do not all carry the same version.

## Code style

Formatting is enforced by `.editorconfig` and `.prettierrc` (3-space indent, double quotes, semicolons) - run `npm run lint:ts-fix`
rather than hand-formatting. Lint rules (`eslint.config.js`) are type-aware; `npm run lint` must be clean.

## Reporting bugs

Open a GitHub issue with the `amuled` version you tested against, the EC opcode(s) involved if known, and - ideally - a minimal
reproduction using `fakeEcServer` rather than a real daemon.
