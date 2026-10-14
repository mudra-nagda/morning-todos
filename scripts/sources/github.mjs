import { fetchJson } from '../lib/http.mjs';
import { DAY, clip } from '../lib/text.mjs';

const PR_FIELDS = `
  number title url isDraft createdAt updatedAt mergeable reviewDecision baseRefName headRefName
  author { login }
  commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
  latestOpinionatedReviews(first: 30) { nodes { author { __typename login } state submittedAt body } }
  reviews(last: 40) { nodes { author { __typename login } state submittedAt body } }
  reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
`;

export async function githubTodos({ token, repos, now }) {
  const gql = async (query, variables) => {
    const body = await fetchJson('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (body.errors) throw new Error(body.errors.map((e) => e.message).join('; '));
    return body.data;
  };
  const search = async (q) => {
    const data = await gql(
      `query($q: String!) { search(query: $q, type: ISSUE, first: 100) { nodes { ... on PullRequest { ${PR_FIELDS} } } } }`,
      { q },
    );
    return data.search.nodes.filter((n) => n && n.number);
  };

  const { viewer } = await gql('query { viewer { login } }');
  const me = viewer.login;
  const scope = repos.map((r) => `repo:${r}`).join(' ');
  const [mine, toReview] = await Promise.all([
    search(`${scope} is:pr is:open author:${me}`),
    search(`${scope} is:pr is:open review-requested:${me}`),
  ]);

  const age = (iso) => (now - new Date(iso)) / DAY;
  const byHead = new Map(mine.map((pr) => [pr.headRefName, pr]));
  const items = [];

  for (const pr of mine) {
    if (pr.isDraft) continue;
    const ref = `#${pr.number}`;
    const base = { source: 'github', links: [{ label: ref, url: pr.url }], since: pr.updatedAt };
    const lastCommit = pr.commits.nodes[0]?.commit;
    const tags = [];
    if (['FAILURE', 'ERROR'].includes(lastCommit?.statusCheckRollup?.state)) tags.push('CI failing');
    if (pr.mergeable === 'CONFLICTING') tags.push('conflicts');

    if (age(pr.createdAt) > 21 && age(pr.updatedAt) > 14) {
      items.push({ ...base, id: `gh:pr:${pr.number}:stale`, section: 'cleanup', title: `Close or revive ${ref} — ${pr.title}`, tags: [`untouched ${Math.floor(age(pr.updatedAt))}d`] });
      continue;
    }

    // Each reviewer's current verdict (GitHub's own per-person latest), ignoring you and bots.
    const human = (author) => author?.login && author.__typename !== 'Bot' && author.login !== me && !author.login.endsWith('[bot]');
    const said = (r) => (r.body?.trim() ? { who: r.author.login, text: clip(r.body, 320) } : null);
    const verdicts = pr.latestOpinionatedReviews.nodes.filter((r) => human(r.author));
    const blocking = verdicts.filter((r) => r.state === 'CHANGES_REQUESTED');
    const approvals = verdicts.filter((r) => r.state === 'APPROVED');
    const approved = pr.reviewDecision === 'APPROVED' || (approvals.length && !blocking.length);

    // Comments from others that arrived after your latest push still need an answer.
    const lastPush = lastCommit?.committedDate ?? '';
    const newerComments = pr.reviews.nodes.filter((r) => human(r.author) && r.state === 'COMMENTED' && r.submittedAt > lastPush);
    const respond = () => {
      const names = [...new Set(newerComments.map((r) => r.author.login))].join(', ');
      const latest = newerComments.filter((r) => r.body?.trim()).at(-1);
      items.push({
        ...base, id: `gh:pr:${pr.number}:respond`, section: 'prs', tags,
        title: `Respond to ${names} on ${ref} — ${pr.title}`,
        context: latest ? [said(latest)] : [],
      });
    };

    if (blocking.length) {
      const names = blocking.map((r) => r.author.login).join(', ');
      const lastRequest = blocking.map((r) => r.submittedAt).sort().at(-1);
      if (lastPush > lastRequest) {
        if (newerComments.length) respond();
        else items.push({ ...base, id: `gh:pr:${pr.number}:ping`, section: 'prs', tags, title: `Ask ${names} to re-review ${ref} — ${pr.title}` });
      } else {
        items.push({
          ...base, id: `gh:pr:${pr.number}:address`, section: 'prs', tags,
          title: `Address ${names}'s changes on ${ref} — ${pr.title}`,
          context: blocking.map(said).filter(Boolean),
        });
      }
      continue;
    }

    if (approved) {
      const parent = byHead.get(pr.baseRefName);
      const verb = pr.mergeable === 'CONFLICTING' ? `Rebase and merge ${ref}` : parent ? `Merge ${ref} after #${parent.number}` : `Merge ${ref}`;
      // Approvals often carry "before you merge…" asks; keep anything beyond an lgtm.
      const notes = approvals.filter((r) => r.body && !/^\W*(lgtm|lg|looks good|approved?)\W*$/i.test(clip(r.body, 400))).map(said);
      items.push({ ...base, id: `gh:pr:${pr.number}:merge`, section: 'merge', title: `${verb} — ${pr.title}`, context: notes, tags });
      continue;
    }

    if (newerComments.length) {
      respond();
      continue;
    }

    const requested = pr.reviewRequests.nodes.map((n) => n.requestedReviewer?.login || n.requestedReviewer?.name).filter(Boolean);
    const anyFeedback = pr.reviews.nodes.some((r) => human(r.author));
    if (!requested.length && !anyFeedback) {
      items.push({ ...base, id: `gh:pr:${pr.number}:reviewer`, section: 'prs', title: `Find a reviewer for ${ref} — ${pr.title}`, tags });
    } else {
      items.push({ ...base, id: `gh:pr:${pr.number}:waiting`, section: 'waiting', title: `${ref} — ${pr.title}`, tags: [`waiting on ${requested.join(', ') || 'reviewers'}`, ...tags] });
    }
  }

  for (const pr of toReview) {
    if (pr.author?.login === me) continue;
    items.push({
      id: `gh:review:${pr.number}`, section: 'reviews', source: 'github',
      title: `Review #${pr.number} — ${pr.title}`,
      links: [{ label: `#${pr.number}`, url: pr.url }],
      since: pr.createdAt,
      tags: [`by ${pr.author?.login ?? 'unknown'}`, ...(pr.isDraft ? ['draft'] : [])],
    });
  }

  return items;
}
