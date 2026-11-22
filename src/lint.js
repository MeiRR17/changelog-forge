import { parseCommit } from './changelog.js';

const TYPES = new Set([
  'feat', 'fix', 'perf', 'refactor', 'docs', 'build', 'ci',
  'test', 'chore', 'style', 'revert'
]);
const MAX_COMMITS = 3000;

/**
 * Audit Conventional Commit subjects without including their content in the
 * diagnostics. Safe for CI logs that should avoid disclosing commit messages.
 *
 * A commit is considered conventional when it has a known type, a nonempty
 * description and the parser recognizes its scope/breaking marker syntax.
 * This audits formatting only, not the truthfulness of developer claims.
 */
export function auditConventionalCommits(commits, { requireScope = false, requireBreakingNote = false } = {}) {
  if (typeof requireScope !== 'boolean') throw new TypeError('requireScope must be boolean.');
  if (typeof requireBreakingNote !== 'boolean') throw new TypeError('requireBreakingNote must be boolean.');
  if (!Array.isArray(commits) || commits.length > MAX_COMMITS) {
    throw new RangeError('Audit accepts up to 3,000 commits.');
  }
  const violations = [];
  const counts = Object.fromEntries([...TYPES].map(type => [type, 0]));
  let breaking = 0;
  for (let index = 0; index < commits.length; index++) {
    const entry = commits[index];
    const parsed = parseCommit(entry);
    if (parsed.breaking) breaking++;
    if (parsed.type === 'other' || !TYPES.has(parsed.originalType)) {
      violations.push({
        hash: parsed.shortHash,
        index: index + 1,
        code: 'NON_CONVENTIONAL_SUBJECT',
        reason: 'Expected type(scope): nonempty description or type!: nonempty description.',
      });
    } else if (requireScope && !parsed.scope) {
      violations.push({
        hash: parsed.shortHash,
        index: index + 1,
        code: 'SCOPE_REQUIRED',
        reason: 'The current CI policy requires type(scope): description.',
      });
    } else if (requireBreakingNote && parsed.breaking && !parsed.breakingNotes.length) {
      violations.push({
        hash: parsed.shortHash,
        index: index + 1,
        code: 'BREAKING_NOTE_REQUIRED',
        reason: 'A breaking commit requires a nonempty BREAKING CHANGE: explanation in its body.',
      });
    } else {
      counts[parsed.type]++;
    }
  }
  return {
    total: commits.length,
    passed: commits.length - violations.length,
    failed: violations.length,
    compliant: violations.length === 0,
    breaking,
    requireScope,
    requireBreakingNote,
    counts,
    violations,
    advisory: 'Formatting audit only; commit message bodies and code changes are not verified.',
  };
}

/** A terse, content-free CI message. Full subject text is never printed. */
export function auditText(report) {
  if (!report || !Array.isArray(report.violations) ||
      !Number.isInteger(report.total) || !Number.isInteger(report.failed)) {
    throw new TypeError('Expected a Conventional Commit audit result.');
  }
  const lines = [
    'Conventional Commit audit: ' + report.passed + '/' + report.total + ' passed.',
  ];
  for (const violation of report.violations) {
    lines.push('- ' + violation.hash + ': ' + violation.code +
      ' (commit #' + violation.index + ')');
  }
  if (report.failed) lines.push('Fix the message format before releasing. No commits were changed.');
  return lines.join('\n') + '\n';
}


/**
 * Hash-free aggregate audit for logs shared outside the development team.
 * Never copies per-commit indices, subjects, hashes, bodies or descriptions
 * into the output. This is an opt-in alternative to per-commit diagnostics.
 */
const AUDIT_CODES = Object.freeze([
  'NON_CONVENTIONAL_SUBJECT', 'SCOPE_REQUIRED', 'BREAKING_NOTE_REQUIRED',
]);
export function auditCountsOnly(report) {
  if (!report || typeof report !== 'object' ||
      !Array.isArray(report.violations) || report.violations.length > MAX_COMMITS ||
      ![report.total, report.passed, report.failed, report.breaking].every(n =>
        Number.isSafeInteger(n) && n >= 0 && n <= MAX_COMMITS) ||
      report.total !== report.passed + report.failed ||
      report.failed !== report.violations.length ||
      report.breaking > report.total ||
      typeof report.requireScope !== 'boolean' ||
      typeof report.requireBreakingNote !== 'boolean' ||
      report.compliant !== (report.failed === 0) ||
      !report.counts || typeof report.counts !== 'object') {
    throw new TypeError('Expected a bounded Conventional Commit audit.');
  }
  const passedByType = Object.fromEntries([...TYPES].map(type => {
    const count = report.counts[type];
    if (!Number.isSafeInteger(count) || count < 0 || count > MAX_COMMITS) {
      throw new TypeError('Invalid passed-commit category count.');
    }
    return [type, count];
  }));
  if (Object.values(passedByType).reduce((a,b) => a + b, 0) !== report.passed) {
    throw new TypeError('Passed-commit categories do not reconcile.');
  }
  const violationsByCode = Object.fromEntries(AUDIT_CODES.map(code => [code, 0]));
  for (const issue of report.violations) {
    if (!issue || typeof issue !== 'object' ||
        !Object.hasOwn(violationsByCode, issue.code)) {
      throw new TypeError('Unknown Conventional Commit violation code.');
    }
    violationsByCode[issue.code]++;
  }
  return {
    format: 'changelog-forge-conventional-audit-counts-v1',
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    compliant: report.compliant,
    breakingMarked: report.breaking,
    requireScope: report.requireScope,
    requireBreakingNote: report.requireBreakingNote,
    passedByType,
    violationsByCode,
    advisory: 'Counts-only format audit. No commit messages, hashes, indices, authors or code. Totals can still disclose activity.',
  };
}

/** Text projection of the same validated summary, with no commit IDs. */
export function auditCountsOnlyText(report) {
  const summary = auditCountsOnly(report);
  const lines = [
    'Conventional Commit counts-only audit: ' +
      summary.passed + '/' + summary.total + ' passed.',
    'Breaking-marked commits: ' + summary.breakingMarked,
    'Accepted by type:',
  ];
  for (const [type, count] of Object.entries(summary.passedByType)) {
    if (count) lines.push('  ' + type + ': ' + count);
  }
  lines.push('Failures by code:');
  if (!summary.failed) lines.push('  none');
  for (const [code, count] of Object.entries(summary.violationsByCode)) {
    if (count) lines.push('  ' + code + ': ' + count);
  }
  if (summary.failed) lines.push('Commit subject policy failed. No files or commits were modified.');
  return lines.join('\n') + '\n';
}


/**
 * Stable one-row CSV for machine-readable CI trend dashboards.
 * Every cell is a trusted format identifier, literal boolean or bounded
 * numeric audit value: no commit subjects, authors, hashes, indices, bodies,
 * per-commit details or filenames can reach this output.
 *
 * Columns are fixed even when all commits pass or the range is empty.
 */
export function auditCountsOnlyCsv(report) {
  const summary = auditCountsOnly(report); // validates aggregate consistency
  const typeHeaders = [...TYPES].map(type => 'accepted_' + type);
  const violationHeaders = AUDIT_CODES.map(code => 'violation_' + code.toLowerCase());
  const headings = [
    'format', 'total', 'passed', 'failed', 'compliant', 'breaking_marked',
    'require_scope', 'require_breaking_note',
    ...typeHeaders, ...violationHeaders,
  ];
  const values = [
    summary.format, summary.total, summary.passed, summary.failed,
    summary.compliant, summary.breakingMarked, summary.requireScope,
    summary.requireBreakingNote,
    ...[...TYPES].map(type => summary.passedByType[type]),
    ...AUDIT_CODES.map(code => summary.violationsByCode[code]),
  ];
  if (headings.length !== values.length) {
    throw new TypeError('Audit columns do not match the values.');
  }
  return '\uFEFF' + [headings, values].map(row => row.map(value =>
    '"' + String(value).replaceAll('"', '""') + '"'
  ).join(',')).join('\r\n') + '\r\n';
}
