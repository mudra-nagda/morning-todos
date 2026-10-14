import { fetchJson } from '../lib/http.mjs';
import { DAY, clip, isoFromSlackTs } from '../lib/text.mjs';

const ymd = (date) => date.toISOString().slice(0, 10);

export async function slackTodos({ token, now }) {
  const call = async (method, params = {}) => {
    const url = new URL(`https://slack.com/api/${method}`);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
    const body = await fetchJson(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!body.ok) throw new Error(`${method}: ${body.error}`);
    return body;
  };

  const { user_id: me } = await call('auth.test');
  const names = new Map();
  const nameOf = async (id) => {
    if (!names.has(id)) {
      const user = await call('users.info', { user: id }).then((r) => r.user).catch(() => null);
      names.set(id, user?.profile?.display_name || user?.real_name || user?.name || 'someone');
    }
    return names.get(id);
  };
  const readable = async (text) => {
    let out = String(text || '');
    for (const [, id] of out.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)) await nameOf(id);
    return out
      .replace(/<@([A-Z0-9]+)(?:\|([^>]+))?>/g, (_, id, label) => `@${label || names.get(id)}`)
      .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
      .replace(/<!(here|channel|everyone)>/g, '@$1')
      .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
      .replace(/<(https?:[^>]+)>/g, '$1')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  };

  const search = (query) =>
    call('search.messages', { query, sort: 'timestamp', sort_dir: 'desc', count: 50 }).then((r) => r.messages.matches);
  const mentions = await search(`<@${me}> after:${ymd(new Date(now - 8 * DAY))}`);
  const dms = await search(`is:dm after:${ymd(new Date(now - 3 * DAY))}`).catch(() => []);

  // A message counts as answered if you posted after it in its thread,
  // or later in the same conversation. Errors mean "couldn't check", not "answered".
  const repliedAfter = async (m) => {
    const channel = m.channel.id;
    const mineAfter = (messages = []) => messages.some((x) => x.user === me && Number(x.ts) > Number(m.ts));
    const threadTs = m.permalink ? new URL(m.permalink).searchParams.get('thread_ts') : null;
    if (threadTs && threadTs !== m.ts) {
      return mineAfter((await call('conversations.replies', { channel, ts: threadTs, limit: 200 })).messages);
    }
    const replies = await call('conversations.replies', { channel, ts: m.ts, limit: 200 }).catch(() => null);
    if (replies && mineAfter(replies.messages)) return true;
    return mineAfter((await call('conversations.history', { channel, oldest: m.ts, limit: 100 })).messages);
  };

  const items = [];
  const seen = new Set();
  const latestDmPerChannel = new Set();
  const candidates = [
    ...mentions.map((m) => ({ m, kind: 'mention' })),
    ...dms.map((m) => ({ m, kind: 'dm' })),
  ];

  for (const { m, kind } of candidates) {
    const key = `${m.channel.id}:${m.ts}`;
    if (seen.has(key) || !m.user || m.user === me || m.user === 'USLACKBOT' || m.bot_id) continue;
    seen.add(key);
    // For plain DMs, only the newest message per conversation matters.
    if (kind === 'dm') {
      if (latestDmPerChannel.has(m.channel.id)) continue;
      latestDmPerChannel.add(m.channel.id);
    }

    let answered = false;
    const tags = [];
    try {
      answered = await repliedAfter(m);
    } catch {
      tags.push("couldn't check replies");
    }
    if (answered) continue;

    const where = m.channel.is_im ? 'in DM' : m.channel.is_mpim ? 'in group DM' : `in #${m.channel.name}`;
    const who = await nameOf(m.user);
    items.push({
      id: `slack:${key}`,
      section: 'slack',
      source: 'slack',
      title: `Reply to ${who} ${where}`,
      context: [{ who, text: clip(await readable(m.text), 320) }],
      links: m.permalink ? [{ label: 'Open in Slack', url: m.permalink }] : [],
      since: isoFromSlackTs(m.ts),
      tags,
    });
    if (items.length >= 20) break;
  }

  return items;
}
