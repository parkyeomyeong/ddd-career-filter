// filter-values.md 를 항목 목록으로 바꾼다.
// "## 1. 회사 규모" → 항목, "- 값" → 값. HTML 주석과 그 외 줄은 무시.
export function parseValues(markdown) {
  const text = markdown.replace(/<!--[\s\S]*?-->/g, '');
  const categories = [];
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(?:\d+\.\s*)?(.+?)\s*$/);
    if (heading) {
      categories.push({ name: heading[1], values: [] });
      continue;
    }
    const item = line.match(/^-\s+(.+?)\s*$/);
    if (item && categories.length) categories.at(-1).values.push(item[1]);
  }
  return categories.filter((c) => c.values.length > 0);
}

export function pickRandom(values, random = Math.random) {
  return values[Math.floor(random() * values.length)];
}
