import { readFile, writeFile } from 'node:fs/promises';

const token = process.env.GITHUB_TOKEN;
const login = process.env.PROFILE_USER || 'goehou';

if (!token) {
  throw new Error('GITHUB_TOKEN is required');
}

// ponytail: Recent Projects 默认按 createdAt 倒序;如果想要别的(如 star 数、手挑),改 sortKey 即可
const sortKey = 'createdAt';
const EXCLUDED = ['frontend-ui-spec', 'tabbit-toy', 'glados-checkin'];
const PINNED = ['Juyu-phone-agent']; // 写死放到 Active Work 末尾

const query = `
query ProfileRepos($login: String!) {
  user(login: $login) {
    repositories(first: 30, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, orderBy: {field: PUSHED_AT, direction: DESC}) {
      nodes {
        name
        description
        url
        pushedAt
        createdAt
        primaryLanguage { name }
        defaultBranchRef {
          target { ... on Commit { history { totalCount } } }
        }
      }
    }
  }
}
`;

const response = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'user-agent': `${login}-profile-stats`,
  },
  body: JSON.stringify({ query, variables: { login } }),
});

if (!response.ok) {
  throw new Error('GitHub GraphQL failed: ' + response.status + ' ' + response.statusText);
}

const payload = await response.json();
if (payload.errors?.length) {
  throw new Error(payload.errors.map((e) => e.message).join('; '));
}

const repos = (payload.data.user?.repositories?.nodes ?? [])
  .filter((r) => r.name !== login && !EXCLUDED.some((e) => r.name.includes(e))) // drop profile repo + excluded
  .map((r) => ({ ...r, commitCount: r.defaultBranchRef?.target?.history?.totalCount ?? 0 }));

if (!repos.length) {
  throw new Error('No public non-fork repos found for ' + login);
}

// Active Work = push/commit 次数最多 + 末尾写死 PINNED;只统计默认分支历史,GitHub 不给跨分支聚合
const pinnedRepos = PINNED.map((name) => repos.find((r) => r.name === name)).filter(Boolean);
const activeWork = repos
  .filter((r) => !PINNED.includes(r.name))
  .slice()
  .sort((a, b) => b.commitCount - a.commitCount)
  .slice(0, 4 - pinnedRepos.length)
  .concat(pinnedRepos);

const recentProjects = repos
  .slice()
  .sort((a, b) => b[sortKey].localeCompare(a[sortKey]))
  .slice(0, 4);

function langBadge(name) {
  if (!name) return '';
  const slug = name.replace(/ /g, '%20');
  return ` ![${name}](https://img.shields.io/badge/--${slug}-8b5cf6?style=flat-square&labelColor=0d1117)`;
}

function repoLine(repo) {
  const badge = langBadge(repo.primaryLanguage?.name);
  const desc = repo.description ? `\n  ${repo.description.replace(/\s+/g, ' ').trim()}` : '';
  return `- [${repo.name}](${repo.url})${badge}${desc}`;
}

function renderSection(list) {
  return list.map(repoLine).join('\n') + '\n';
}

// Replace the body between a `### Heading` and the next `### ` (or EOF)
function replaceSection(readme, heading, body) {
  const re = new RegExp('(### ' + heading + '\\n)([\\s\\S]*?)(\\n### |$)');
  return readme.replace(re, (_m, pre, _old, post) => `${pre}${body}${post}`);
}

const readmePath = 'README.md';
const original = await readFile(readmePath, 'utf8');
let readme = original;
readme = replaceSection(readme, 'Active Work', renderSection(activeWork));
readme = replaceSection(readme, 'Recent Projects', renderSection(recentProjects));

if (readme === original) {
  // ponytail: heading 真缺失才算错误;数据没变导致内容不变是正常情况,正常退出即可
  if (!/### Active Work\n/.test(original) || !/### Recent Projects\n/.test(original)) {
    throw new Error('README headings "Active Work" / "Recent Projects" not found');
  }
  console.log('No changes — README already up to date');
  process.exit(0);
}

await writeFile(readmePath, readme, 'utf8');
console.log('Refreshed README for ' + login + ': active=' + activeWork.map(r => r.name).join(',') + ', recent=' + recentProjects.map(r => r.name).join(','));

