#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildChangelog } from '../src/changelog.js';
import { recommendRelease } from '../src/version.js';
import { auditConventionalCommits, auditText, auditCountsOnly, auditCountsOnlyText, auditCountsOnlyCsv } from '../src/lint.js';

const HELP = [
  'changelog-forge — Conventional Commits to Markdown release notes',
  '',
  'Usage: changelog-forge [options]',
  '',
  '  --repo PATH       Local Git repository path (default current directory)',
  '  --from REF        Include commits after this tag/commit (exclusive)',
  '  --to REF          End ref (default HEAD)',
  '  --all             Use entire available history instead of last reachable tag',
  '  --version X.Y.Z   Release version (default Unreleased)',
  '  --recommend-from X.Y.Z  Suggest next stable SemVer from this version',
  '  --check-conventional     CI check: 0 if all subjects conventional, 1 otherwise',
  '  --check-conventional --json  Emit redacted machine-readable CI results',
  '  --summary-only           With CI audit: only aggregate counts; no commit hashes or indices',
  '  --csv                    With CI --summary-only: one CSV row of aggregate counts',
  '  --require-scope          In CI check mode, demand type(scope): description',
  '  --require-breaking-note  In CI mode, require an explanatory BREAKING CHANGE body note',
  '  --date YYYY-MM-DD Release date (only used with --version)',
  '  --json            Print structured notes as JSON',
  '  --output FILE     Write to a file instead of stdout',
  '  --force           Overwrite output file if it exists',
  '  --help            Show this help',
  '',
  'Examples:',
  '  changelog-forge --repo .',
  '  changelog-forge --from v1.2.0 --version 1.3.0',
  '  changelog-forge --all --json',
  '  changelog-forge --from v1.2.0 --recommend-from 1.2.0',
  '  changelog-forge --from v1.2.0 --check-conventional',
  '  changelog-forge --from v1.2.0 --check-conventional --json',
  '  changelog-forge --from v1.2.0 --check-conventional --summary-only --json',
  '  changelog-forge --from v1.2.0 --check-conventional --summary-only --csv',
  '  changelog-forge --from v1.2.0 --check-conventional --require-breaking-note --json',
  '  changelog-forge --output RELEASE_NOTES.md',
].join('\n');

function safeRef(ref) {
  if (typeof ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) ||
      ref.includes('..') || ref.includes('//') || ref.endsWith('/') || ref.endsWith('.')) {
    throw new Error('Invalid Git ref: ' + ref);
  }
  return ref;
}

function runGit(repo, args, optional = false) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw new Error('Git is not available: ' + result.error.message);
  if (result.status !== 0) {
    if (optional) return null;
    throw new Error('Git command failed: ' + (result.stderr || '').trim().slice(0, 500));
  }
  return result.stdout.trim();
}

/**
 * A changelog describes changes *since* an earlier point on the same
 * history. Git's A..B syntax also accepts diverged refs, but then silently
 * subtracts commits from an unrelated line of development. Refuse that
 * misleading range rather than claim a complete sequential release.
 */
function requireAncestor(repo, from, to) {
  if (!from) return; // --all / no reachable tag includes all history.
  const result = spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', from, to], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024,
  });
  if (result.error) throw new Error('Git ancestry check failed: ' + result.error.message);
  if (result.status === 0) return;
  if (result.status === 1) {
    throw new Error('The start ref is not an ancestor of the end ref. Select a reachable --from ref; no partial release notes or audit were produced.');
  }
  throw new Error('Unable to verify release range ancestry; check that both refs resolve to commits.');
}

function parseArgs(args) {
  const opts = { repo: '.', to: 'HEAD', all: false, json: false, force: false };
  const single = new Set(['--repo', '--from', '--to', '--version', '--date', '--output', '--recommend-from']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help' || flag === '-h') { opts.help = true; continue; }
    if (flag === '--all') { opts.all = true; continue; }
    if (flag === '--json') { opts.json = true; continue; }
    if (flag === '--csv') { opts.csv = true; continue; }
    if (flag === '--check-conventional') { opts.checkConventional = true; continue; }
    if (flag === '--summary-only') { opts.summaryOnly = true; continue; }
    if (flag === '--require-scope') { opts.requireScope = true; continue; }
    if (flag === '--require-breaking-note') { opts.requireBreakingNote = true; continue; }
    if (flag === '--force') { opts.force = true; continue; }
    if (!single.has(flag)) throw new Error('Unknown option: ' + flag + '. Try --help.');
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing argument for ' + flag + '.');
    opts[flag.slice(2)] = value;
  }
  if (opts.all && opts.from) throw new Error('Choose --all or --from, not both.');
  if (opts.date && !opts.version) throw new Error('--date requires --version.');
  if (opts.force && !opts.output) throw new Error('--force requires --output.');
  if (opts.summaryOnly && !opts.checkConventional) {
    throw new Error('--summary-only requires --check-conventional.');
  }
  if (opts.csv && (!opts.checkConventional || !opts.summaryOnly || opts.json)) {
    throw new Error('--csv requires --check-conventional --summary-only, without --json.');
  }
  if (opts.requireScope && !opts.checkConventional) {
    throw new Error('--require-scope requires --check-conventional.');
  }
  if (opts.requireBreakingNote && !opts.checkConventional) {
    throw new Error('--require-breaking-note requires --check-conventional.');
  }
  if (opts.checkConventional && (opts.version || opts.date || opts.output ||
      opts.force || opts['recommend-from'])) {
    throw new Error('--check-conventional is a read-only CI mode and cannot be combined with release or output flags.');
  }
  safeRef(opts.to);
  if (opts.from) safeRef(opts.from);
  return opts;
}

function collect(repo, from, to, limit = 3000) {
  const args = [
    'log', '--no-merges',
    '--format=%H%x1f%s%x1f%b%x1e',
    '--max-count=' + limit,
    from ? from + '..' + to : to,
  ];
  const output = runGit(repo, args);
  if (!output) return [];
  return output.split('\x1e').map(item => item.trim()).filter(Boolean).map(record => {
    const fields = record.split('\x1f');
    // Do not silently discard malformed records and publish incomplete notes.
    // Only the last field (body) is allowed to contain extra delimiters.
    if (fields.length < 3 || !/^[a-f0-9]{40,64}$/i.test(fields[0])) {
      throw new Error('Git log contained a malformed commit record. No release notes were generated.');
    }
    const [hash, subject, ...body] = fields;
    return { hash, subject: subject.trim(), body: body.join('\x1f').trim() };
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(HELP + '\n'); return; }
  const repo = resolve(options.repo);
  runGit(repo, ['rev-parse', '--is-inside-work-tree']);
  const from = options.all ? null : options.from ??
    runGit(repo, ['describe', '--tags', '--abbrev=0', options.to], true);
  // Fail closed when an explicit start ref is on a different history line.
  // A reachable tag is normally an ancestor, but enforce the same contract
  // for explicit and automatically discovered starting points.
  requireAncestor(repo, from, options.to);
  // Read one extra record in *all* modes: release notes and CI auditing
  // must never appear complete when a Git log limit was exceeded.
  const commits = collect(repo, from, options.to, 3001);
  if (commits.length > 3000) {
    throw new RangeError('More than 3,000 commits in the range. Narrow --from/--to; no partial release notes or audit was generated.');
  }
  if (options.checkConventional) {
    const audit = auditConventionalCommits(commits, {
      requireScope: Boolean(options.requireScope),
      requireBreakingNote: Boolean(options.requireBreakingNote),
    });
    // The audit object contains only counts, short hashes and finding codes.
    // Do not print Git subjects, bodies or author metadata in CI JSON mode.
    process.stdout.write(options.csv ? auditCountsOnlyCsv(audit) :
      options.json ?
        JSON.stringify(options.summaryOnly ? auditCountsOnly(audit) : audit, null, 2) + '\n' :
        options.summaryOnly ? auditCountsOnlyText(audit) : auditText(audit));
    if (!audit.compliant) process.exitCode = 1;
    return;
  }
  const report = buildChangelog(commits, { version: options.version || null, date: options.date || null });
  const recommendation = options['recommend-from']
    ? recommendRelease(commits, options['recommend-from']) : null;
  let markdown = report.markdown;
  if (recommendation) {
    const detail = recommendation.nextVersion
      ? 'Suggested next version: **' + recommendation.nextVersion + '** (' + recommendation.bump + ')'
      : 'No SemVer release is indicated by these commits.';
    const lines = markdown.split('\n');
    const insertAt = lines.findIndex(line => line.startsWith('## '));
    if (insertAt >= 0) lines.splice(insertAt + 2, 0,
      '> ' + detail + '. **Advisory only:** verify your release policy before tagging.\n');
    markdown = lines.join('\n');
  }
  const output = options.json ?
    JSON.stringify({ from: from || null, to: options.to, ...report, ...(recommendation ? { recommendation } : {}) }, null, 2) + '\n' :
    markdown;
  if (options.output) {
    writeFileSync(options.output, output, { encoding: 'utf8', flag: options.force ? 'w' : 'wx' });
    process.stderr.write('Wrote ' + commits.length + ' commits to ' + options.output + '\n');
  } else process.stdout.write(output);
}

try { main(); }
catch (error) {
  process.stderr.write('changelog-forge: ' + (error.message || String(error)) + '\n');
  process.exitCode = 2;
}
