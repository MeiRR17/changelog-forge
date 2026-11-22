#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildChangelog } from '../src/changelog.js';
import { recommendRelease } from '../src/version.js';
import { auditConventionalCommits, auditText } from '../src/lint.js';

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
  '  --require-scope          In CI check mode, demand type(scope): description',
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

function parseArgs(args) {
  const opts = { repo: '.', to: 'HEAD', all: false, json: false, force: false };
  const single = new Set(['--repo', '--from', '--to', '--version', '--date', '--output', '--recommend-from']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help' || flag === '-h') { opts.help = true; continue; }
    if (flag === '--all') { opts.all = true; continue; }
    if (flag === '--json') { opts.json = true; continue; }
    if (flag === '--check-conventional') { opts.checkConventional = true; continue; }
    if (flag === '--require-scope') { opts.requireScope = true; continue; }
    if (flag === '--force') { opts.force = true; continue; }
    if (!single.has(flag)) throw new Error('Unknown option: ' + flag + '. Try --help.');
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing argument for ' + flag + '.');
    opts[flag.slice(2)] = value;
  }
  if (opts.all && opts.from) throw new Error('Choose --all or --from, not both.');
  if (opts.date && !opts.version) throw new Error('--date requires --version.');
  if (opts.force && !opts.output) throw new Error('--force requires --output.');
  if (opts.requireScope && !opts.checkConventional) {
    throw new Error('--require-scope requires --check-conventional.');
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
  // Read one extra record in *all* modes: release notes and CI auditing
  // must never appear complete when a Git log limit was exceeded.
  const commits = collect(repo, from, options.to, 3001);
  if (commits.length > 3000) {
    throw new RangeError('More than 3,000 commits in the range. Narrow --from/--to; no partial release notes or audit was generated.');
  }
  if (options.checkConventional) {
    const audit = auditConventionalCommits(commits, { requireScope: Boolean(options.requireScope) });
    // The audit object contains only counts, short hashes and finding codes.
    // Do not print Git subjects, bodies or author metadata in CI JSON mode.
    process.stdout.write(options.json ? JSON.stringify(audit, null, 2) + '\n' : auditText(audit));
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
