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
    node bin/changelog-forge.js --from v1.2.0 --check-conventional --require-breaking-note
    node bin/changelog-forge.js --from v1.2.0 --check-conventional --json
    node bin/changelog-forge.js --from v1.2.0 --check-conventional --summary-only --json
    node bin/changelog-forge.js --from v1.2.0 --check-conventional --summary-only --csv
    node bin/changelog-forge.js --from v1.2.0 --recommend-from 1.2.0
    node bin/changelog-forge.js --output RELEASE_NOTES.md

The default uses commits between the most recent reachable tag and HEAD. If no tag can be found, it uses the available local history. Before reading commits, the CLI now requires the start ref (`--from` or the discovered tag) to be an **ancestor** of the selected end ref (`--to`, default `HEAD`). Git ordinarily allows `A..B` even when branches have diverged; this tool rejects such non-sequential ranges with exit status **2** rather than publishing misleading release notes, a SemVer recommendation or an incomplete Conventional Commit audit. Equal start/end refs are allowed and produce an empty range. Use an ancestor tag or commit, or choose `--all` to inspect all history reachable from the selected end. The ancestry check uses local Git metadata only; no tags or history are changed. This tool does not fetch, clone, or push anything.

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

**Optional breaking-note policy:** `--require-breaking-note` enforces a nonempty `BREAKING CHANGE:` (or `BREAKING-CHANGE:`) explanation in the commit body for every otherwise valid Conventional Commit marked breaking, including `feat(api)!: ...`. An exclamation mark alone is allowed by Conventional Commits but is insufficient **when this stricter opt-in team policy is enabled**. The policy accepts an indented continuation of an explanatory breaking-note paragraph, but not an empty marker. Violations use the code `BREAKING_NOTE_REQUIRED`; output never includes the explanatory text. This can be combined with `--require-scope` and `--json`. Library callers can pass `{ requireBreakingNote: true }` to `auditConventionalCommits()`. This is a format policy, not proof of migration impact.

The mode is read-only; it does not generate release notes, edit files or create Git tags. It cannot be combined with `--output`, `--version`, `--date`, `--recommend-from` or `--force`; `--json` is permitted specifically to produce a redacted machine-readable audit. Library callers can use:

    import { auditConventionalCommits, auditText } from './src/lint.js';
    const audit = auditConventionalCommits(commits);

The audit's commit list is bounded to 3,000. As with changelog generation, the CLI fetches **one additional record** to detect oversized ranges and fails with exit code **2** instead of reporting success after silently checking a truncated subset. Narrow `--from`/`--to` when needed. Atypical custom Conventional Commit types are reported as unsupported by the current configured type list.

### Aggregate-only CI audit

For CI artifacts that must not disclose even short commit hashes or individual ordinal positions, use `--check-conventional --summary-only`. This prints **counts only**: total/passed/failed, number of breaking-marked messages, accepted counts by conventional type, violation counts by fixed error code and the selected `--require-scope` / `--require-breaking-note` policy. Adding `--json` produces the versioned `changelog-forge-conventional-audit-counts-v1` format, suitable for dashboards. Neither form includes commit hashes, subjects, author identities, individual indices, commit bodies, or the contents of violations. Even aggregate counts can reveal development activity.

`--summary-only` requires `--check-conventional` and is incompatible with release-note generation. It does not alter the existing audit exit statuses: `0` for full compliance, `1` for at least one format violation, `2` for Git/usage/collection errors. It still scans the **entire requested range** with the existing 3,000-commit bound and never suppresses failures. `auditCountsOnly(report)` and `auditCountsOnlyText(report)` are pure library projections of an `auditConventionalCommits()` result and reject inconsistent totals before serialization.

### Spreadsheet-ready aggregate CI reporting

Use `--check-conventional --summary-only --csv` to emit a **single bounded, UTF-8 BOM-prefixed CSV record** suitable for a local spreadsheet or CI history dashboard. The stable header includes total, passed, failed, compliant, breaking-marked count, selected scope/breaking-note policies, one `accepted_<type>` column per supported Conventional Commit type and one `violation_<code>` column per fixed violation code. Even a compliant or empty commit range produces the same columns, including zero-valued categories. Each field is a fixed program-generated identifier, boolean or bounded integer rather than commit-controlled content; all fields are also CSV-quoted. CRLF line endings are used for spreadsheet import.

CSV remains a **counts-only** report: no commit hashes, indices, subjects, bodies, author information or source paths are serialized. Aggregate activity can nevertheless be sensitive. `--csv` is valid **only** with `--check-conventional --summary-only` and cannot be combined with `--json`; invalid combinations return usage status **2**. Existing CI semantics remain unchanged: **0** for full compliance, **1** for any audit violation and **2** for Git/usage/collection errors. Output goes to stdout without writing files or modifying history. Library callers can use `auditCountsOnlyCsv(report)` alongside the existing JSON and text projections.

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
- `--require-breaking-note` — only with `--check-conventional`, require an explanatory nonempty breaking-change footer/body paragraph for every breaking commit
- `--summary-only` — only with `--check-conventional`, output a hash-free aggregate audit (with optional `--json` or `--csv`) while preserving failure exit status
- `--csv` — only with `--check-conventional --summary-only`, a fixed-schema spreadsheet row; cannot be combined with `--json`
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

The library works entirely on supplied strings and objects without Git access. Its Markdown output escapes formatting characters from commit descriptions and scope names. Both `buildChangelog()` and `recommendRelease()` now validate **previously parsed** commit objects via the shared `normalizeCommitEntry()` helper instead of trusting the presence of a `shortHash` field. Inconsistent SHA prefixes, invalid group types, missing descriptions and malformed breaking notes are rejected rather than causing misleading release grouping or recommendations. Raw `{ hash, subject, body }` Git entries keep their existing parsing behavior. This is structural validation, not proof that commit text or metadata is authentic.

## Scope and cautions

This tool **does not** create a GitHub release, publish a package, update version numbers, create tags, or mutate repository history. It only reads local Git history and renders notes.

Date values in release headings are provided by the caller and are checked for real Gregorian calendar validity. A syntactically valid release date does not certify when a release actually happened. Commit messages may contain private information: review generated notes before publishing them externally.

**Implementation-only status:** The owner requested that automated tests be deferred until a consolidated testing round. This version has not been validated for production use.

## Files

- `src/changelog.js` — parser, grouping and Markdown rendering
- `src/version.js` — pure, conservative stable SemVer bump recommendation
- `src/lint.js` — Conventional Commit formatting audit, redacted per-commit CI report and aggregate-only text/JSON/CSV summaries
- `bin/changelog-forge.js` — Git collector and CLI
- `package.json` — Node.js 22+ package entry points
- `LICENSE` — MIT

## Author

Built by Meir Dvir · https://github.com/MeiRR17
