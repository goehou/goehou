import { mkdir, writeFile } from 'node:fs/promises';

const token = process.env.GITHUB_TOKEN;
const login = process.env.PROFILE_USER || 'goehou';
const now = new Date();
const yearStart = `${now.getUTCFullYear()}-01-01T00:00:00Z`;
const generatedAt = now.toISOString().slice(0, 10);

if (!token) {
  throw new Error('GITHUB_TOKEN is required');
}

const theme = {
  title: '#8b5cf6',
  text: '#c9d1d9',
  muted: '#8b949e',
  icon: '#8b5cf6',
  track: '#30363d',
};

const query = `
query ProfileStats($login: String!, $yearStart: DateTime!) {
  user(login: $login) {
    login
    followers { totalCount }
    repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, orderBy: {field: STARGAZERS, direction: DESC}) {
      totalCount
      nodes {
        stargazerCount
        forkCount
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
          edges {
            size
            node { name color }
          }
        }
      }
    }
    contributionsCollection(from: $yearStart) {
      contributionCalendar { totalContributions }
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      restrictedContributionsCount
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
  body: JSON.stringify({ query, variables: { login, yearStart } }),
});

if (!response.ok) {
  throw new Error(`GitHub GraphQL failed: ${response.status} ${response.statusText}`);
}

const payload = await response.json();
if (payload.errors?.length) {
  throw new Error(payload.errors.map((error) => error.message).join('; '));
}

const user = payload.data.user;
if (!user) {
  throw new Error(`GitHub user not found: ${login}`);
}

const repos = user.repositories.nodes ?? [];
const contributions = user.contributionsCollection;
const totals = {
  stars: repos.reduce((sum, repo) => sum + repo.stargazerCount, 0),
  forks: repos.reduce((sum, repo) => sum + repo.forkCount, 0),
  repos: user.repositories.totalCount,
  followers: user.followers.totalCount,
  contributions: contributions.contributionCalendar.totalContributions,
  commits: contributions.totalCommitContributions,
  prs: contributions.totalPullRequestContributions,
  issues: contributions.totalIssueContributions,
  reviews: contributions.totalPullRequestReviewContributions,
};

const languages = new Map();
for (const repo of repos) {
  for (const edge of repo.languages.edges ?? []) {
    const name = edge.node.name;
    const current = languages.get(name) ?? { name, color: edge.node.color || theme.icon, size: 0 };
    current.size += edge.size;
    languages.set(name, current);
  }
}

const topLanguages = [...languages.values()]
  .sort((a, b) => b.size - a.size)
  .slice(0, 6);
const languageTotal = topLanguages.reduce((sum, language) => sum + language.size, 0) || 1;

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function statRow(icon, label, value, x, y, valueX = x + 245) {
  return `
    <text x="${x}" y="${y}" class="icon">${escapeXml(icon)}</text>
    <text x="${x + 28}" y="${y}" class="label">${escapeXml(label)}</text>
    <text x="${valueX}" y="${y}" class="value" text-anchor="end">${escapeXml(formatNumber(value))}</text>`;
}

function renderStatsSvg() {
  return `<svg width="480" height="165" viewBox="0 0 480 165" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(login)} GitHub stats">
  <style>
    .title { fill: ${theme.title}; font: 600 18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .label { fill: ${theme.text}; font: 500 14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .value { fill: ${theme.title}; font: 700 14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .icon { fill: ${theme.icon}; font: 700 13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
    .muted { fill: ${theme.muted}; font: 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  </style>
  <text x="24" y="31" class="title">${escapeXml(login)}'s GitHub Stats</text>
  ${statRow('ST', 'Total Stars Earned', totals.stars, 26, 62, 258)}
  ${statRow('FK', 'Total Forks', totals.forks, 26, 88, 258)}
  ${statRow('RP', 'Public Repositories', totals.repos, 26, 114, 258)}
  ${statRow('CY', `Contributions (${now.getUTCFullYear()})`, totals.contributions, 26, 140, 258)}
  ${statRow('CM', 'Commits', totals.commits, 282, 62, 456)}
  ${statRow('PR', 'Pull Requests', totals.prs, 282, 88, 456)}
  ${statRow('IS', 'Issues', totals.issues, 282, 114, 456)}
  ${statRow('FW', 'Followers', totals.followers, 282, 140, 456)}
  <text x="456" y="31" class="muted" text-anchor="end">${generatedAt}</text>
</svg>
`;
}

function renderTopLanguagesSvg() {
  let cursor = 24;
  const segments = topLanguages.map((language) => {
    const width = Math.max(8, (language.size / languageTotal) * 312);
    const segment = `<rect x="${cursor.toFixed(2)}" y="50" width="${width.toFixed(2)}" height="8" rx="4" fill="${escapeXml(language.color)}"/>`;
    cursor += width;
    return segment;
  }).join('\n  ');

  const rows = topLanguages.map((language, index) => {
    const x = index % 2 === 0 ? 24 : 190;
    const y = 86 + Math.floor(index / 2) * 26;
    const percent = ((language.size / languageTotal) * 100).toFixed(1);
    return `<circle cx="${x}" cy="${y - 4}" r="5" fill="${escapeXml(language.color)}"/>
    <text x="${x + 13}" y="${y}" class="label">${escapeXml(language.name)}</text>
    <text x="${x + 132}" y="${y}" class="percent" text-anchor="end">${percent}%</text>`;
  }).join('\n    ');

  return `<svg width="360" height="165" viewBox="0 0 360 165" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(login)} top languages">
  <style>
    .title { fill: ${theme.title}; font: 600 18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .label { fill: ${theme.text}; font: 500 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .percent { fill: ${theme.muted}; font: 500 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .muted { fill: ${theme.muted}; font: 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  </style>
  <text x="24" y="31" class="title">Most Used Languages</text>
  <rect x="24" y="50" width="312" height="8" rx="4" fill="${theme.track}"/>
  ${segments}
  ${rows}
  <text x="336" y="31" class="muted" text-anchor="end">auto-generated</text>
</svg>
`;
}

await mkdir('profile', { recursive: true });
await writeFile('profile/stats.svg', renderStatsSvg(), 'utf8');
await writeFile('profile/top-langs.svg', renderTopLanguagesSvg(), 'utf8');
console.log(`Generated profile stats for ${login}`);
