# Contributing

Thanks for considering a contribution to `amule-ec`. This is a small,
zero-dependency library, so the bar for adding dependencies or abstractions
is high - when in doubt, open an issue to discuss the approach before
sending a pull request.

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
npm run format                   # prettier --write on src/ and tests/
```

`npm run repl` starts an interactive REPL (`tests/repl/main.ts`) against a
real local `amuled`, reading `~/.aMule/amule.conf` directly - useful for
verifying protocol assumptions against a live daemon rather than only the
mocked `fakeEcServer` used by the unit tests.

## Protocol changes

Opcodes, tag layouts and enum values must be verified against aMule's own
C++ source, not the EC protocol PDF doc - it has repeatedly proven
incomplete or wrong on non-trivial points. If a change touches wire format
or opcode handling, say in the PR description which C++ source file(s) you
checked.

## Before opening a pull request

- `npm run lint` and `npm run test` both pass.
- New behavior has unit tests (see `tests/*.test.ts` and `tests/fakeEcServer.ts`
  for the mocking pattern already in use).
- Public API changes are reflected in `README.md`'s usage example if relevant.

## Code style

Formatting is enforced by `.editorconfig` and `.prettierrc` (3-space indent,
double quotes, semicolons) - run `npm run format` rather than hand-formatting.
Lint rules (`eslint.config.js`) are type-aware; `npm run lint` must be clean.

## Reporting bugs

Open a GitHub issue with the `amuled` version you tested against, the
EC opcode(s) involved if known, and - ideally - a minimal reproduction using
`fakeEcServer` rather than a real daemon.
