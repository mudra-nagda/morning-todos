# Morning list

A personal todo page that rebuilds itself every morning at **8am Pacific** from:

- **GitHub** (`kognitos/bumblebee`): your PRs that need action (address changes, respond to comments, ask for a re-review, merge, find a reviewer), PRs waiting on your review, and stale PRs to close or revive
- **Linear**: issues assigned to you (anything with an SLA due within 48h, or on-call, goes to the top), unread mentions, and project update reminders
- **Slack**: @mentions and DMs from the last few days that you haven't replied to (it checks thread replies, not just the top-level message)

You can tick off a whole todo, or **select any part of a todo** to tick off just that part or split it into its own todo. Ticks and splits carry over to the next morning. Anything resolved upstream overnight is listed under "resolved overnight".

## Privacy

GitHub Pages sites are public. Your todos are **encrypted** (AES-GCM, with a key derived from your passphrase) before they're published, and decrypted in your browser. The repo only ever holds the code and a timestamp (`data/meta.json`). Workflow logs show counts, never todo text.

## Setup (one time)

1. **Repository secrets** (Settings → Secrets and variables → Actions → New repository secret):

   | Secret | What it is |
   |---|---|
   | `TODO_PASSPHRASE` | Required. A long passphrase you choose, e.g. five random words. Save it in your password manager. You'll type it once per device. |
   | `BUMBLEBEE_TOKEN` | GitHub fine-grained token. Resource owner: `kognitos`. Repository: `bumblebee`. Permissions: *Pull requests: Read-only*. Your org may need to approve it. |
   | `LINEAR_API_KEY` | Linear → Settings → Security & access → Personal API keys. Read access is enough. |
   | `SLACK_USER_TOKEN` | Optional. Create a Slack app at api.slack.com/apps. Under OAuth & Permissions, add *User Token Scopes* `search:read`, `channels:history`, `groups:history`, `im:history`, `mpim:history` and `users:read`. Install it, then copy the `xoxp-…` user token. Workspace admins may need to approve the app. |

   Any source you leave out is skipped, and the page says so.

2. **Pages**: Settings → Pages → Build and deployment → Source: **GitHub Actions**.

3. **First run**: Actions → *Morning todos* → **Run workflow**. Then open `https://<your-username>.github.io/<repo-name>/` and enter your passphrase.

## How the schedule works

GitHub cron runs in UTC and ignores daylight saving, so the workflow is scheduled at both 15:00 and 16:00 UTC. `scripts/gate.mjs` lets through the first run at or after 8am Pacific each day and skips the other. Scheduled runs can start a few minutes late, which is why it runs at 8am for a 9am read. You can also run it any time from the Actions tab.

## Good to know

- Ticks and splits are saved in your browser, so your laptop and phone each keep their own.
- If a refresh fails, the page keeps showing the last good list with a "more than a day old" warning, and the Actions run turns red.

## Local preview

```bash
GH_TOKEN="$(gh auth token)" node scripts/generate.mjs --plain site/data/preview.json
python3 -m http.server 8765 --directory site
```

`site/data/` is git-ignored, so a local preview is never committed.
