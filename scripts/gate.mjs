// GitHub cron runs in UTC and ignores daylight saving, so the workflow fires at
// both 15:00 and 16:00 UTC. This lets exactly one of them through each day: the
// first run at or after 8am Pacific. Manual and push runs always go through.
import fs from 'node:fs';

const now = process.env.NOW ? new Date(process.env.NOW) : new Date();
const pacific = (date, options) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', ...options }).format(date);
const pacificDay = (date) => pacific(date, { year: 'numeric', month: '2-digit', day: '2-digit' });

let run = true;
let reason = `event: ${process.env.EVENT}`;
if (process.env.EVENT === 'schedule') {
  const hour = Number(pacific(now, { hour: '2-digit', hourCycle: 'h23' }));
  let last = null;
  try {
    last = JSON.parse(fs.readFileSync('data/meta.json', 'utf8')).generatedAt;
  } catch {}
  const doneToday = last && pacificDay(new Date(last)) === pacificDay(now);
  run = hour >= 8 && hour < 11 && !doneToday;
  reason = `pacific hour ${hour}, already ran today: ${Boolean(doneToday)}`;
}

console.log(`run=${run} (${reason})`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\n`);
