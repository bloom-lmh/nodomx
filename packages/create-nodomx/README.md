# `create-nodomx`

Starter generator for NodomX applications.

Usage:

```bash
create-nodomx my-app
create-nodomx my-app --install
create-nodomx my-app --package-mode local --install
```

`registry` mode writes semver package ranges for publish-ready templates.
`local` mode writes `file:` dependencies so the template can be tested against this repository directly.
