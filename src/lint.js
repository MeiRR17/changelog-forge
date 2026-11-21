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
export function auditConventionalCommits(commits) {
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
        reason: 'Expected type(scope): description or type!: description with a supported type.',
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
