import { normalizeCommitEntry } from './changelog.js';

/**
 * Pure, conservative SemVer release recommendation.
 * Follows Conventional Commits: BREAKING -> major, feat -> minor,
 * fix/perf -> patch, other changes -> no release recommendation.
 *
 * A strict policy applies even to 0.x.y: a breaking commit suggests 1.0.0.
 * Teams with prerelease or pre-1.0 custom policies should not automate on
 * this heuristic without reviewing the recommendation.
 */
function parseStableVersion(version) {
  if (typeof version !== 'string' ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new RangeError('Base version must be stable SemVer X.Y.Z without a leading v.');
  }
  const numbers = version.split('.').map(Number);
  if (numbers.some(n => !Number.isSafeInteger(n))) throw new RangeError('Version component exceeds safe integer range.');
  return numbers;
}
function nextVersion(parts, bump) {
  const [major, minor, patch] = parts;
  let values;
  if (bump === 'major') values = [major + 1, 0, 0];
  else if (bump === 'minor') values = [major, minor + 1, 0];
  else if (bump === 'patch') values = [major, minor, patch + 1];
  else return null;
  if (values.some(n => !Number.isSafeInteger(n))) throw new RangeError('Next version exceeds safe integer range.');
  return values.join('.');
}

/**
 * @param {Array<{hash:string,subject:string,body?:string}|object>} commits
 * @param {string} currentVersion Stable SemVer (for example 1.2.3)
 * @returns {{currentVersion:string,nextVersion:string|null,bump:string,counts:object,reason:string}}
 */
export function recommendRelease(commits, currentVersion) {
  if (!Array.isArray(commits)) throw new TypeError('Commits must be an array.');
  const parsedVersion = parseStableVersion(currentVersion);
  const changes = commits.map(normalizeCommitEntry);
  const counts = { breaking: 0, features: 0, fixes: 0, performance: 0, other: 0 };
  for (const commit of changes) {
    if (commit.breaking) counts.breaking++;
    if (commit.type === 'feat') counts.features++;
    else if (commit.type === 'fix') counts.fixes++;
    else if (commit.type === 'perf') counts.performance++;
    else counts.other++;
  }
  const bump = counts.breaking ? 'major' :
    counts.features ? 'minor' :
    (counts.fixes || counts.performance) ? 'patch' : 'none';
  const reason = bump === 'major' ? 'At least one breaking change.' :
    bump === 'minor' ? 'New features with no breaking changes.' :
    bump === 'patch' ? 'Fixes or performance changes with no new features or breaking changes.' :
    'No breaking, feat, fix or perf commits indicate a SemVer release.';
  return {
    currentVersion,
    nextVersion: nextVersion(parsedVersion, bump),
    bump,
    counts,
    reason,
    advisory: 'Suggestion only; review release policy and commit messages before tagging or publishing.',
  };
}
