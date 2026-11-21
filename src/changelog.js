/**
 * Conventional Commit release note processing.
 * All inputs are plain strings; no Git access or network calls in this module.
 */
const GROUPS = [
  ['feat', 'Features'], ['fix', 'Bug Fixes'], ['perf', 'Performance'],
  ['refactor', 'Refactoring'], ['docs', 'Documentation'],
  ['build', 'Build'], ['ci', 'Continuous Integration'],
  ['test', 'Tests'], ['chore', 'Maintenance'], ['style', 'Styling'],
  ['revert', 'Reverts'],
];
const NAMES = new Map(GROUPS);
const COMMIT_PATTERN = /^([a-z][a-z0-9-]*)(?:\(([^()\r\n]{1,80})\))?(!)?:\s*(.+)$/i;

function extractBreaking(body) {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  const notes = [];
  for (let i = 0; i < lines.length; i++) {
    const marker = /^BREAKING(?: CHANGE|-CHANGE):\s*(.*)$/i.exec(lines[i]);
    if (!marker) continue;
    const content = [marker[1]];
    while (i + 1 < lines.length && /^[ \t]+\S/.test(lines[i + 1])) {
      content.push(lines[++i].trim());
    }
    notes.push(content.join(' ').trim());
  }
  return notes.filter(Boolean);
}

/**
 * Turn Git metadata into a normalized entry. If not conventional, retain it
 * under 'Other Changes' rather than silently losing developer contributions.
 */
export function parseCommit(commit) {
  if (!commit || typeof commit !== 'object') throw new TypeError('Commit must be an object.');
  const { hash, subject, body = '' } = commit;
  if (typeof hash !== 'string' || !/^[a-f0-9]{7,64}$/i.test(hash) ||
      typeof subject !== 'string' || typeof body !== 'string') {
    throw new TypeError('Commit requires a hash, subject and optional body string.');
  }
  const candidate = COMMIT_PATTERN.exec(subject.trim());
  // A heading with only whitespace after the colon is not conventional.
  const match = candidate && candidate[4].trim() ? candidate : null;
  const type = match ? match[1].toLowerCase() : 'other';
  const breakingNotes = extractBreaking(body);
  return {
    hash,
    shortHash: hash.slice(0, 7),
    type: NAMES.has(type) ? type : 'other',
    originalType: type,
    scope: match ? (match[2] || '') : '',
    description: match ? match[4].trim() : subject.trim(),
    breaking: Boolean(match?.[3]) || breakingNotes.length > 0,
    breakingNotes,
  };
}

const INLINE_ESCAPE = /([\\\x60*_{}\[\]<>|])/g;
function safeMd(value) {
  return String(value).replace(/\s+/g, ' ').trim().replace(INLINE_ESCAPE, '\\$1');
}

function bullet(commit, includeHash = true) {
  const scope = commit.scope ? '**' + safeMd(commit.scope) + ':** ' : '';
  return '- ' + scope + safeMd(commit.description) +
    (includeHash ? ' (' + commit.shortHash + ')' : '');
}

/** Summarize a list of commits, preserving incoming commit order. */
export function buildChangelog(commits, { version = null, date = null } = {}) {
  if (!Array.isArray(commits)) throw new TypeError('Commits must be an array.');
  if (version !== null && (typeof version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))) {
    throw new RangeError('Version must be SemVer (for example 1.2.3).');
  }
  if (date !== null && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    throw new RangeError('Date must be YYYY-MM-DD.');
  }
  const parsed = commits.map(c => c.shortHash ? c : parseCommit(c));
  const groups = GROUPS.map(([type, title]) => ({ type, title, commits: [] }));
  groups.push({ type: 'other', title: 'Other Changes', commits: [] });
  const breaking = [];
  for (const item of parsed) {
    if (item.breaking) breaking.push(item);
    else groups.find(group => group.type === item.type).commits.push(item);
  }
  const title = version ? '[' + version + ']' + (date ? ' - ' + date : '') : '[Unreleased]';
  const lines = ['# Changelog', '', '## ' + title, ''];
  if (!parsed.length) lines.push('No commits in the selected range.', '');
  if (breaking.length) {
    lines.push('### Breaking Changes', '');
    for (const item of breaking) {
      lines.push(bullet(item), '');
      for (const note of item.breakingNotes) lines.push('  - ' + safeMd(note));
      if (item.breakingNotes.length) lines.push('');
    }
  }
  for (const group of groups) {
    if (!group.commits.length) continue;
    lines.push('### ' + group.title, '');
    for (const item of group.commits) lines.push(bullet(item));
    lines.push('');
  }
  return {
    markdown: lines.join('\n').trimEnd() + '\n',
    total: parsed.length,
    breakingCount: breaking.length,
    groups: groups.filter(g => g.commits.length).map(g => ({
      type: g.type, title: g.title, count: g.commits.length,
    })),
    changes: parsed,
  };
}
