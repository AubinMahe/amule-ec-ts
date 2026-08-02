# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
uses [Semantic Versioning](https://semver.org/).

Beyond bug fixes, future changes are driven by the upstream
[amule-org/amule](https://github.com/amule-org/amule) C++ project: new EC
opcodes/tags or protocol behavior changes there are what this client
tracks - see CONTRIBUTING.md for how such changes are verified against that
source before being reflected here.

## [Unreleased]

## [1.0.0] - 2026-08-02

### Added

- EC protocol client: connection, challenge/response authentication
  (MD5-hashed password), automatic reconnect with exponential backoff.
- `Downloads`, `Uploads`, `Servers`, `SharedFiles`, `Status`, `Log`, `Search`
  services, each covering its EC_OP_* request/reply pair and, where
  applicable, server-pushed notifications.
- Zero-dependency, per-topic run-time tracing via `NODE_DEBUG` (see
  README.md's "Debugging" section).
