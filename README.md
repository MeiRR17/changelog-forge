# Changelog Forge

Generate readable release notes from local Git history using the [Conventional Commits](https://www.conventionalcommits.org/) message convention. This is a dependency-free Node.js CLI and a reusable ESM library, with no network calls.

## Quick start

Requires Node.js 22+ and Git on your computer.

    node bin/changelog-forge.js --help
    node bin/changelog-forge.js --repo .
    node bin/changelog-forge.js --from v1.2.0 --version 1.3.0
    node bin/changelog-forge.js --all --json
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

## Optional SemVer recommendation

`--recommend-from X.Y.Z` reads the same Conventional Commit range and **suggests** a next stable SemVer value. The input must be a stable `X.Y.Z` version without a `v` prefix. This option never edits package files, publishes a release or creates Git tags.

Precedence: breaking change (`!` or `BREAKING CHANGE:`) → **major**; nonbreaking `feat` → **minor**; nonbreaking `fix` or `perf` → **patch**. If none apply, the suggestion is **none** rather than inventing a release. JSON output includes a `recommendation` object with the selected bump, next version (or null), counts and reasoning. Markdown output adds a separate advisory note.

This is **strict SemVer**. A breaking change at `0.4.2` suggests `1.0.0`; teams that use a custom pre-1.0 policy must review the recommendation manually. Prerelease and build-metadata versions are intentionally not accepted as starting points.


## CLI options

- `--repo PATH` — repository path, default current directory
- `--from REF` — exclusive start ref (tag, branch or commit)
- `--to REF` — inclusive end ref, default HEAD
- `--all` — ignore the default most recent reachable tag and summarize all available commits
- `--version X.Y.Z` — generate a release heading instead of Unreleased
- `--recommend-from X.Y.Z` — add a **non-binding** stable SemVer recommendation based on the same commit range
- `--date YYYY-MM-DD` — optional release heading date when version is specified
- `--json` — emit structured JSON with groups, commit entries and Markdown text
- `--output FILE` — save to a file instead of stdout
- `--force` — explicitly permit overwriting an existing output file
- `--help` — show usage information

Without `--force`, an existing output file is never overwritten. The CLI skips merge commits and limits collection to 3,000 commits per invocation. Use an explicit `--from` for predictable release boundaries in projects with many tags.

## Library use

    import { parseCommit, buildChangelog } from './src/changelog.js';
    const result = buildChangelog([
      { hash: 'abcdef1234567890', subject: 'feat(api): add endpoints', body: '' }
    ]);
    process.stdout.write(result.markdown);

The library works entirely on supplied strings and objects without Git access. Its Markdown output escapes formatting characters from commit descriptions and scope names.

## Scope and cautions

This tool **does not** create a GitHub release, publish a package, update version numbers, create tags, or mutate repository history. It only reads local Git history and renders notes.

Date values in release headings are provided by the caller. Commit messages may contain private information: review generated notes before publishing them externally.

**Implementation-only status:** The owner requested that automated tests be deferred until a consolidated testing round. This version has not been validated for production use.

## Files

- `src/changelog.js` — parser, grouping and Markdown rendering
- `src/version.js` — pure, conservative stable SemVer bump recommendation
- `bin/changelog-forge.js` — Git collector and CLI
- `package.json` — Node.js 22+ package entry points
- `LICENSE` — MIT

## Author

Built by Meir Dvir · https://github.com/MeiRR17
