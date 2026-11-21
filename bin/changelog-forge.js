#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildChangelog } from '../src/changelog.js';

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
  const single = new Set(['--repo', '--from', '--to', '--version', '--date', '--output']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help' || flag === '-h') { opts.help = true; continue; }
    if (flag === '--all') { opts.all = true; continue; }
    if (flag === '--json') { opts.json = true; continue; }
    if (flag === '--force') { opts.force = true; continue; }
    if (!single.has(flag)) throw new Error('Unknown option: ' + flag + '. Try --help.');
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing argument for ' + flag + '.');
    opts[flag.slice(2)] = value;
  }
  if (opts.all && opts.from) throw new Error('Choose --all or --from, not both.');
  if (opts.date && !opts.version) throw new Error('--date requires --version.');
  if (opts.force && !opts.output) throw new Error('--force requires --output.');
  safeRef(opts.to);
  if (opts.from) safeRef(opts.from);
  return opts;
}

function collect(repo, from, to) {
  const args = [
    'log', '--no-merges',
    '--format=%H%x1f%s%x1f%b%x1e',
    '--max-count=3000',
    from ? from + '..' + to : to,
  ];
  const output = runGit(repo, args);
  if (!output) return [];
  return output.split('\x1e').map(item => item.trim()).filter(Boolean).flatMap(record => {
    const fields = record.split('\x1f');
    if (fields.length < 3) return [];
    const [hash, subject, ...body] = fields;
    return [{ hash: hash.trim(), subject: subject.trim(), body: body.join('\x1f').trim() }];
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(HELP + '\n'); return; }
  const repo = resolve(options.repo);
  runGit(repo, ['rev-parse', '--is-inside-work-tree']);
  const from = options.all ? null : options.from ??
    runGit(repo, ['describe', '--tags', '--abbrev=0', options.to], true);
  const commits = collect(repo, from, options.to);
  const report = buildChangelog(commits, { version: options.version || null, date: options.date || null });
  const output = options.json ?
    JSON.stringify({ from: from || null, to: options.to, ...report }, null, 2) + '\n' :
    report.markdown;
  if (options.output) {
    writeFileSync(options.output, output, { encoding: 'utf8', flag: options.force ? 'w' : 'wx' });
    process.stderr.write('Wrote ' + commits.length + ' commits to ' + options.output + '\n');
  } else process.stdout.write(output);
}

try { main(); }
catch (error) {
  process.stderr.write('changelog-forge: ' + (error.message || String(error)) + '\n');
  process.exitCode = 1;
}
