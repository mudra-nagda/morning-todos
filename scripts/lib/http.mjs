const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// fetch + JSON with retries on rate limits and transient server errors.
export async function fetchJson(url, init = {}, { retries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(retryAfter ? retryAfter * 1000 : 1500 * (attempt + 1));
      continue;
    }
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 160)}`);
    }
    if (!res.ok) throw new Error(`${res.status} ${body.message || res.statusText}`);
    return body;
  }
}
