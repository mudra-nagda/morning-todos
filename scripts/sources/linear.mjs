import { fetchJson } from '../lib/http.mjs';
import { DAY, clip } from '../lib/text.mjs';

const ISSUES = `query {
  viewer {
    assignedIssues(first: 100, filter: { state: { type: { in: ["triage", "unstarted", "started"] } } }) {
      nodes { identifier title url priority slaBreachesAt createdAt updatedAt state { name type } team { key } }
    }
  }
}`;

// `title`/`subtitle`/`url` on the Notification interface cover PR-review notifications;
// if the API doesn't expose them we fall back to the issue/project fragments only.
const notificationsQuery = (extended) => `query {
  notifications(first: 100) {
    nodes {
      id type readAt archivedAt snoozedUntilAt createdAt
      actor { name }
      ${extended ? 'title subtitle url' : ''}
      ... on IssueNotification { issue { identifier title url } comment { body url } }
      ... on ProjectNotification { project { name url } }
    }
  }
}`;

const PRIORITY = { 1: 'Urgent', 2: 'High' };

export async function linearTodos({ apiKey, now }) {
  const gql = async (query) => {
    const body = await fetchJson('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (body.errors) throw new Error(body.errors.map((e) => e.message).join('; '));
    return body.data;
  };

  const issues = (await gql(ISSUES)).viewer.assignedIssues.nodes;
  let notifications;
  try {
    notifications = (await gql(notificationsQuery(true))).notifications.nodes;
  } catch (error) {
    if (!/cannot query field/i.test(error.message)) throw error;
    notifications = (await gql(notificationsQuery(false))).notifications.nodes;
  }

  const items = [];
  for (const issue of issues) {
    const slaHours = issue.slaBreachesAt ? (new Date(issue.slaBreachesAt) - now) / 36e5 : null;
    const urgent = (slaHours !== null && slaHours < 48) || issue.priority === 1 || issue.team?.key === 'OC';
    const tags = [issue.state.name];
    if (PRIORITY[issue.priority]) tags.push(PRIORITY[issue.priority]);
    if (slaHours !== null) tags.push(slaHours < 0 ? 'SLA breached' : `SLA in ${slaHours < 24 ? `${Math.max(1, Math.round(slaHours))}h` : `${Math.round(slaHours / 24)}d`}`);
    items.push({
      id: `linear:${issue.identifier}`,
      section: urgent ? 'urgent' : 'linear',
      source: 'linear',
      text: `${issue.state.type === 'triage' ? 'Triage ' : ''}${issue.identifier} — ${issue.title}`,
      links: [{ label: issue.identifier, url: issue.url }],
      since: issue.updatedAt,
      tags,
    });
  }

  const assigned = new Set(issues.map((i) => i.identifier));
  for (const n of notifications) {
    if (n.readAt || n.archivedAt) continue;
    if (n.snoozedUntilAt && new Date(n.snoozedUntilAt) > now) continue;
    if (now - new Date(n.createdAt) > 7 * DAY) continue;
    const actor = n.actor?.name || 'Someone';
    const base = { id: `linear:notif:${n.id}`, source: 'linear', since: n.createdAt };

    if (n.type === 'projectUpdatePrompt') {
      const name = n.project?.name || n.title || 'your project';
      const url = n.project?.url || n.url;
      items.push({ ...base, section: 'urgent', text: `Post the project update for ${name}`, links: url ? [{ label: 'Project', url }] : [], tags: ['due'] });
      continue;
    }

    const mention = /mention/i.test(n.type);
    const assignedComment = n.type === 'issueNewComment' && n.issue && assigned.has(n.issue.identifier);
    if (!mention && !assignedComment) continue;

    const subject = n.issue ? `${n.issue.identifier} — ${n.issue.title}` : n.title;
    const url = n.comment?.url || n.issue?.url || n.url;
    if (!subject || !url) continue;
    const snippet = n.comment?.body || n.subtitle;
    items.push({
      ...base,
      section: 'linear',
      text: `${mention ? 'Reply to' : 'New comment from'} ${actor} on ${subject}${snippet ? `\n“${clip(snippet)}”` : ''}`,
      links: [{ label: n.issue?.identifier || 'Linear', url }],
      tags: [],
    });
  }

  return items;
}
