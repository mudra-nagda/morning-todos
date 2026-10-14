// Collects todos from GitHub, Linear and Slack, then writes the encrypted
// payload the site reads. Usage:
//   node scripts/generate.mjs                  -> site/data/todos.enc.json (needs TODO_PASSPHRASE)
//   node scripts/generate.mjs --plain <file>   -> unencrypted JSON, for local previews only
import fs from 'node:fs/promises';
import { encryptJson } from './lib/crypto.mjs';
import { githubTodos } from './sources/github.mjs';
import { linearTodos } from './sources/linear.mjs';
import { slackTodos } from './sources/slack.mjs';

const SECTIONS = [
  { id: 'urgent', title: 'Do first' },
  { id: 'prs', title: 'Your PRs' },
  { id: 'merge', title: 'Ready to merge' },
  { id: 'reviews', title: 'Reviews for others' },
  { id: 'slack', title: 'Slack replies' },
  { id: 'linear', title: 'Linear' },
  { id: 'cleanup', title: 'Cleanup' },
  { id: 'waiting', title: 'Waiting on others', collapsed: true },
];

const env = process.env;
const now = env.NOW ? new Date(env.NOW) : new Date();
const plainIndex = process.argv.indexOf('--plain');
const plainOut = plainIndex > -1 ? process.argv[plainIndex + 1] : null;
const repos = (env.REPOS || 'kognitos/bumblebee').split(',').map((r) => r.trim()).filter(Boolean);

if (!plainOut && !env.TODO_PASSPHRASE) {
  console.error('TODO_PASSPHRASE is not set. Refusing to publish unencrypted todos.');
  process.exit(1);
}

const sources = {};
const items = [];
async function collect(name, configured, load) {
  if (!configured) {
    sources[name] = { ok: false, skipped: true, error: 'not configured' };
    return;
  }
  try {
    const found = await load();
    items.push(...found);
    sources[name] = { ok: true, count: found.length };
  } catch (error) {
    sources[name] = { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
}

await collect('github', Boolean(env.GH_TOKEN), () => githubTodos({ token: env.GH_TOKEN, repos, now }));
await collect('linear', Boolean(env.LINEAR_API_KEY), () => linearTodos({ apiKey: env.LINEAR_API_KEY, now }));
await collect('slack', Boolean(env.SLACK_USER_TOKEN), () => slackTodos({ token: env.SLACK_USER_TOKEN, now }));

// Oldest first within each section: the longer something has waited, the higher it sits.
const order = new Map(SECTIONS.map((s, i) => [s.id, i]));
items.sort((a, b) => order.get(a.section) - order.get(b.section) || String(a.since).localeCompare(String(b.since)));

const payload = { version: 1, generatedAt: now.toISOString(), sections: SECTIONS, sources, items };

// Logs are public on a public repo: counts only, never todo text.
for (const [name, s] of Object.entries(sources)) {
  console.log(`${name}: ${s.ok ? `${s.count} todos` : s.skipped ? 'skipped (not configured)' : `FAILED - ${s.error}`}`);
}

if (!Object.values(sources).some((s) => s.ok)) {
  console.error('No source succeeded; keeping the previous deployment.');
  process.exit(1);
}

if (plainOut) {
  await fs.writeFile(plainOut, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${items.length} todos (unencrypted) to ${plainOut}`);
} else {
  await fs.mkdir('site/data', { recursive: true });
  await fs.writeFile('site/data/todos.enc.json', JSON.stringify(await encryptJson(payload, env.TODO_PASSPHRASE)));
  await fs.writeFile('data/meta.json', `${JSON.stringify({ generatedAt: payload.generatedAt }, null, 2)}\n`);
  console.log(`Wrote ${items.length} encrypted todos`);
}
