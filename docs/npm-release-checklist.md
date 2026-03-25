# NodomX npm Release Checklist

This repository currently publishes these packages together:

- `@nodomx/nd-compiler`
- `@nodomx/rollup-plugin-nd`
- `@nodomx/rollup-plugin-dev-server`
- `create-nodomx`

## Publisher checklist

- Make sure the publishing account can publish under the `@nodomx` scope.
- Make sure the same account can publish the unscoped `create-nodomx` package.
- Use the official npm registry: `https://registry.npmjs.org/`.
- Enable npm 2FA for publish operations.
- Run `npm run release:preflight` from the repo root before every real publish.

If `release:preflight` fails because the registry is a mirror, switch it before publishing:

```bash
npm config set registry https://registry.npmjs.org/
npm login --registry https://registry.npmjs.org/
```

## Tag strategy

- Use `latest` for stable releases that are ready for general users.
- Use `next` for beta or release-candidate builds such as `0.3.0-beta.1`.
- Use a custom tag like `canary` only for short-lived internal verification builds.

Examples:

```bash
npm run release:publish -- --tag latest
npm run release:publish -- --tag next
npm run release:publish -- --tag canary
```

`release:publish` already targets the official npm registry by default.

## Version strategy

All publishable packages move in lockstep through `npm run release:version`.

- `patch`: fixes, tooling polish, HMR stability improvements, documentation-only runtime clarifications
- `minor`: new public APIs, new `.nd` capabilities, new CLI or VSCode features without breaking existing usage
- `major`: breaking runtime semantics, breaking `.nd` syntax, renamed packages, removed APIs

Examples:

```bash
npm run release:version -- patch
npm run release:version -- minor
npm run release:version -- major
npm run release:version -- 0.3.0-beta.1
```

## Recommended release flow

1. Run `npm run release:preflight`.
2. Run `npm run release:version -- <patch|minor|major|exact-version>`.
3. Run `npm run release:changelog -- <next-version> --since <git-ref>`.
4. Run `npm run release:check`.
5. Run `npm run release:publish -- --dry-run`.
6. Run the real publish with the correct `--tag` and optional `--otp`.

Stable example:

```bash
npm run release:version -- patch
npm run release:check
npm run release:publish -- --tag latest --otp <code>
```

Beta example:

```bash
npm run release:version -- 0.3.0-beta.1
npm run release:check
npm run release:publish -- --tag next --otp <code>
```
