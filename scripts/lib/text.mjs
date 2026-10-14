export const DAY = 864e5;

// One-line, markdown/HTML-free excerpt for quoting a comment inside a todo.
export function clip(input, max = 220) {
  const flat = String(input || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export const isoFromSlackTs = (ts) => new Date(Number(ts) * 1000).toISOString();
