# Changelog Forge

Generate readable release notes from local Git history using the [Conventional Commits](https://www.conventionalcommits.org/) message convention. This is a dependency-free Node.js CLI and a reusable ESM library, with no network calls.

## Quick start

Requires Node.js 22+ and Git on your computer.

    node bin/changelog-forge.js --help
    node bin/changelog-forge.js --repo .
    node bin/changelog-forge.js --from v1.2.0 --version 1.3.0
    node bin/changelog-forge.js --all --json
    node bin/changelog-forge.js --from v1.2.0 --check-conventional
    node bin/changelog-forge.js --from v1.2.0 --check-conventional --require-scope
    node bin/changelog-forge.js --from v1.2.0 --check-conventional --json
    node bin/changelog-forge.js --from v1.2.0 --recommend-from 1.2.0
    node bin/changelog-forge.js --output RELEASE_NOTES.md

The default uses commits between the most recent reachable tag and HEAD. If no tag can be found, it uses the available local history. This tool does not fetch, clone, or push anything.

## Supported commit messages

    feat(api): add password reset
    fix(auth): handle expired token
    feat(storage)!: change bucket naming
    docs: explain first-run setup

When a commit body contains `BREAKING CHANGE:` or `BREAKING-CHANGE:`, it is grouped under Breaking Changes. A Conventional Commit header using an exclamation mark before the colon also marks a breaking change.

Group headings include Features, Bug Fixes, Performance, Refactoring, Documentation, Build, CI, Tests, Maintenance, Styling, Reverts and Other Changes. Non-conventional commits are kept in Other Changes rather than silently lost.

An example output:

    # Changelog

    ## [Unreleased]

    ### Features

    - **api:** add password reset (abcdef1)

    ### Bug Fixes

    - **auth:** handle expired token (1234567)

Commit SHA prefixes are included to keep entries traceable without inventing issue or PR links.

## CI Conventional Commit audit

Use `--check-conventional` on the same local Git range as the changelog. The tool checks that each commit subject uses a supported Conventional Commit type (such as `feat`, `fix`, `docs`, `ci` or `chore`), optional scope and a nonempty description.

    node bin/changelog-forge.js --from v1.2.0 --check-conventional

The result contains **short commit hashes and finding codes only**, not raw message contents, author emails or changed code. Add `--json` to `--check-conventional` for a structured audit with `total`, `passed`, `failed`, `compliant`, grouped counts and per-violation short hashes, indices and codes. JSON mode retains the same exit statuses and redaction guarantees, and never writes release notes or edits files. Exit codes: **0** all subjects have an accepted conventional format, **1** at least one does not, **2** Git/usage/validation error. This is a *formatting audit*, not verification that commits truthfully describe code changes, or that release/version policy is correct.

Optional `--require-scope` enforces `type(scope): description` for teams that require scoped commits. The default still permits unscoped conventional commits. The audit also rejects headers whose description is only whitespace; findings are `SCOPE_REQUIRED` or `NON_CONVENTIONAL_SUBJECT` without exposing subject text.

The mode is read-only; it does not generate release notes, edit files or create Git tags. It cannot be combined with `--output`, `--version`, `--date`, `--recommend-from` or `--force`; `--json` is permitted specifically to produce a redacted machine-readable audit. Library callers can use:

    import { auditConventionalCommits, auditText } from './src/lint.js';
    const audit = auditConventionalCommits(commits);

The audit's commit list is bounded to 3,000. As with changelog generation, the CLI fetches **one additional record** to detect oversized ranges and fails with exit code **2** instead of reporting success after silently checking a truncated subset. Narrow `--from`/`--to` when needed. Atypical custom Conventional Commit types are reported as unsupported by the current configured type list.

## Optional SemVer recommendation

`--recommend-from X.Y.Z` reads the same Conventional Commit range and **suggests** a next stable SemVer value. The input must be a stable `X.Y.Z` version without a `v` prefix. This option never edits package files, publishes a release or creates Git tags.

Precedence: breaking change (`!` or `BREAKING CHANGE:`) → **major**; nonbreaking `feat` → **minor**; nonbreaking `fix` or `perf` → **patch**. If none apply, the suggestion is **none** rather than inventing a release. JSON output includes a `recommendation` object with the selected bump, next version (or null), counts and reasoning. Markdown output adds a separate advisory note.

This is **strict SemVer**. A breaking change at `0.4.2` suggests `1.0.0`; teams that use a custom pre-1.0 policy must review the recommendation manually. Prerelease and build-metadata versions are intentionally not accepted as starting points.


## CLI options

- `--repo PATH` — repository path, default current directory
- `--from REF` — exclusive start ref (tag, branch or commit)
- `--to REF` — inclusive end ref, default HEAD
- `--all` — ignore the default most recent reachable tag and summarize all available commits
- `--version X.Y.Z` — generate a release heading instead of Unreleased; validates full SemVer syntax, including prerelease/build metadata, and rejects numeric prerelease identifiers with leading zeros
- `--recommend-from X.Y.Z` — add a **non-binding** stable SemVer recommendation based on the same commit range
- `--check-conventional` — read-only CI audit of Conventional Commit subject formatting, outputting short hashes and codes only (plain text or, with `--json`, structured redacted audit results)
- `--require-scope` — only with `--check-conventional`, require a nonempty scope on every commit
- `--date YYYY-MM-DD` — optional release heading date when version is specified; rejects impossible dates (including non-leap-year February 29)
- `--json` — emit structured changelog JSON with groups, commit entries and Markdown text; with `--check-conventional`, emit redacted audit JSON instead
- `--output FILE` — save to a file instead of stdout
- `--force` — explicitly permit overwriting an existing output file
- `--help` — show usage information

Without `--force`, an existing output file is never overwritten. The CLI skips merge commits and supports **at most 3,000 commits per range**, in both changelog generation and CI audit modes. It deliberately reads one extra record to detect truncation and fails with exit code 2 rather than publishing incomplete release notes. Malformed Git log records likewise abort generation instead of being silently skipped. Use an explicit `--from` for predictable release boundaries in projects with many tags.

## Library use

    import { parseCommit, buildChangelog } from './src/changelog.js';
    const result = buildChangelog([
      { hash: 'abcdef1234567890', subject: 'feat(api): add endpoints', body: '' }
    ]);
    process.stdout.write(result.markdown);

The library works entirely on supplied strings and objects without Git access. Its Markdown output escapes formatting characters from commit descriptions and scope names.

## Scope and cautions

This tool **does not** create a GitHub release, publish a package, update version numbers, create tags, or mutate repository history. It only reads local Git history and renders notes.

Date values in release headings are provided by the caller and are checked for real Gregorian calendar validity. A syntactically valid release date does not certify when a release actually happened. Commit messages may contain private information: review generated notes before publishing them externally.

**Implementation-only status:** The owner requested that automated tests be deferred until a consolidated testing round. This version has not been validated for production use.

## Files

- `src/changelog.js` — parser, grouping and Markdown rendering
- `src/version.js` — pure, conservative stable SemVer bump recommendation
- `src/lint.js` — Conventional Commit formatting audit and redacted CI report
- `bin/changelog-forge.js` — Git collector and CLI
- `package.json` — Node.js 22+ package entry points
- `LICENSE` — MIT

## Author

Built by Meir Dvir · https://github.com/MeiRR17
