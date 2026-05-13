# /release

Cut a release with one command. Bumps version files, commits, tags, and pushes — driving any CI release workflow you have configured.

## Usage

```
/release              # ask which bump
/release patch        # 0.1.3 → 0.1.4
/release minor        # 0.1.3 → 0.2.0
/release major        # 0.1.3 → 1.0.0
/release 1.2.3        # explicit
/release v1.2.3       # leading v is stripped; tag re-adds it
```

## What it does

1. **Preflight** — checks clean tree, branch, remote sync, no duplicate tag. For non-private `package.json` projects, also pings the npm registry so we fail early instead of letting CI's `pnpm publish` fail after the GH release is already made.
2. **Discovers version files** — Node (`package.json`), TS/JS (`src/version.ts`), Rust (`Cargo.toml`), Python (`pyproject.toml`, `__version__`). Refuses if none found.
3. **Bumps + commits + tags** — single Conventional Commits bump, annotated tag, no force-push. When version files have pre-release suffixes like `0.1.0-dev` (intentional template markers), they're treated as agreeing with `0.1.0` so the agreement check doesn't false-fire.
4. **Pushes commits then tags separately** — so a pre-push hook failure doesn't leave a tag stranded.
5. **Prints CI links** — Actions URL, GH release URL, and (for Node projects) the eventual npm package URL.

## Project conventions it understands

| File | Detection |
|---|---|
| `package.json` | top-level `"version"` |
| `src/version.{ts,js}`, `version.{ts,js}`, `lib/version.{ts,js}` | `VERSION = "..."` literal |
| `Cargo.toml` | `[package] version = "..."` |
| `pyproject.toml` | `[project] version` or `[tool.poetry] version` |
| `__init__.py` (Python) | `__version__ = "..."` |

If a project has multiple version sources, they all get updated together — the skill stops if they disagree before the bump.

## What it won't do

- Force-push, skip hooks, or amend.
- Re-release an existing tag.
- Touch files outside the discovered version sources.
- Publish to a registry (npm/PyPI/crates.io). Wire that into your CI workflow instead.
