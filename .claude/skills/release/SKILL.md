---
name: release
description: Cut a release. Bumps version files, commits, tags, pushes. Handles semver (patch/minor/major) or explicit versions. Works across Node, Rust, Python, and ad-hoc version files.
allowed-tools: Bash(git *) Bash(gh *) Bash(jq *) Bash(cat *) Bash(grep *) Bash(ls *) Read Edit Write
---

## Current state

```!
echo "=== branch ==="
git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "(not a git repo)"
echo
echo "=== clean? ==="
git status --short
echo
echo "=== ahead/behind remote? ==="
git rev-list --left-right --count "@{u}...HEAD" 2>/dev/null | awk '{ printf "behind: %s   ahead: %s\n", $1, $2 }' || echo "(no upstream)"
echo
echo "=== last tags ==="
git tag --sort=-version:refname | head -5 || echo "(no tags yet)"
echo
echo "=== remote ==="
git remote get-url origin 2>/dev/null || echo "(no origin remote)"
echo
echo "=== release workflow files ==="
ls .github/workflows/ 2>/dev/null | grep -iE 'release|publish' || echo "(no release workflow detected)"
echo
echo "=== version-bearing files ==="
for f in package.json src/version.ts src/version.js version.ts version.js lib/version.ts lib/version.js Cargo.toml pyproject.toml; do
  [ -f "$f" ] && echo "  $f"
done
grep -lE '__version__\s*=' --include='*.py' -r . 2>/dev/null | head -3
```

## What you're doing

The user wants to cut a release. Argument $1 is one of:

- `patch` / `minor` / `major` — semver bump from the current version
- explicit version like `1.2.3` or `v1.2.3`
- empty — ask the user which they want

## Workflow

1. **Preflight** — stop or ask the user if any of these are off:
   - Working tree dirty (offer to commit/stash first, or abort)
   - On a non-default branch (warn and confirm; some projects do release branches)
   - Local branch behind origin (pull or warn)
   - Tag for the target version already exists (always abort — don't retag)

2. **Discover version-bearing files**. Be thorough; many projects have more than one:
   - `package.json` (top-level `version`)
   - `src/version.ts` / `src/version.js` / `version.ts` / `version.js` / `lib/version.*` (look for a `VERSION = "..."` literal)
   - `Cargo.toml` (`[package].version`)
   - `pyproject.toml` (`[project].version` or `[tool.poetry].version`)
   - `__init__.py` files with `__version__ = "..."`

   If none found, ask the user where the version lives. Don't guess.

3. **Read current versions** from every discovered source. If they disagree, surface the disagreement and stop — the user has to fix the inconsistency first.

4. **Compute new version**:
   - For `patch` / `minor` / `major`, apply the semver bump (drop any pre-release / build metadata).
   - For an explicit input, strip a leading `v` and validate it parses as semver. The git tag will add the `v` back.

5. **Apply**:
   - Update every discovered version file in-place.
   - `git add` only those files, commit with Conventional Commits: `chore: release v<NEW>`.
   - Create an annotated tag: `git tag -a v<NEW> -m "Release v<NEW>"`.

6. **Push**:
   - `git push` then `git push --tags`. Two pushes, not `--follow-tags`, so a hook failure on the first doesn't leave the tag unpublished.
   - If a release workflow file exists in `.github/workflows/`, print:
     - The release page: `https://github.com/<owner>/<repo>/releases/tag/v<NEW>` (won't exist yet — CI creates it)
     - The Actions page: `https://github.com/<owner>/<repo>/actions`
   - If `gh` is on PATH, offer (don't force) to `gh run watch` the just-triggered run.

## Constraints

- Use Conventional Commits format for the bump commit (`chore: release v…`).
- **Never force-push.**
- **Never skip git hooks** (no `--no-verify`).
- **Never create a tag without first committing the version-file bump** — the tagged commit must reflect the released version.
- **Never re-release an existing tag.** If `v<NEW>` already exists, stop.
- If the push is rejected, surface the error and stop — do not retry with force.
- If `node` / `jq` is available, parse `package.json` with it rather than regex. For TOML, prefer `tomlq` if present, otherwise simple sed against `^version = "..."` under `[package]` / `[project]`.

## Finish

Show:
- The bump commit hash
- The tag name
- The Actions URL (if applicable)
- A one-line "what to watch": `gh run watch` command, or the URL to the workflow run.
