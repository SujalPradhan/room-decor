/** Parse data published in the HTML. Never execute storefront JavaScript. */
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue => v && typeof v === "object" && !Array.isArray(v) ? v as ObjectValue : {};
function label(v: unknown): string {
  const raw = object(object(v).value).text;
  return typeof raw === "string" ? raw.trim().slice(0, 500)
    : Array.isArray(raw) ? raw.filter(x => typeof x === "string").join(" ").trim().slice(0, 500) : "";
}
function initialState(html: string): ObjectValue {
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const source = script[1], assignment = /\bwindow\.__INITIAL_STATE__\s*=\s*(\{)/.exec(source);
    if (!assignment) continue;
    const start = assignment.index + assignment[0].length - 1;
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < source.length; i++) {
      const c = source[i];
      if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
      if (c === '"') quoted = true;
      else if (c === "{" || c === "[") depth++;
      else if ((c === "}" || c === "]") && --depth === 0) {
        try { return object(JSON.parse(source.slice(start, i + 1))); } catch { break; }
      }
    }
  }
  return {};
}
export function flipkartSpecifications(html: string, productId?: string): { measurements: string[]; variant: string } {
  const state = object(initialState(html).multiWidgetState), pageId = object(state.pageMeta).productId;
  if (productId && pageId !== productId) return { measurements: [], variant: "" };
  const measurements: string[] = [], variants = new Set<string>();
  let visited = 0;
  function walk(value: unknown, depth = 0) {
    if (++visited > 60_000 || depth > 35 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.slice(0, 300).forEach(v => walk(v, depth + 1)); return; }
    for (const [key, child] of Object.entries(object(value))) {
      if (/^rpd_specifications_grid_layout_\d+$/.test(key)) {
        const groups = object(object(child).value).gridData_0;
        const list = object(groups).value;
        if (Array.isArray(list)) for (const group of list.slice(0, 30)) {
          const body = object(object(group).value), section = label(body.label_0);
          // Shipping/seat/reclined sizes are not the normal assembled footprint.
          const grid = Object.entries(body).find(([k]) => /^rpd_grid_\d+$/.test(k))?.[1];
          const rows = object(object(object(grid).value).gridData_0).value;
          if (!Array.isArray(rows)) continue;
          for (const row of rows.slice(0, 100)) {
            const fields = object(object(row).value), name = label(fields.label_0), text = label(fields.label_1);
            if (/^(?:assembled |overall |product )?dimensions$/i.test(section) && /^(?:width|depth|height)$/i.test(name) && text)
              measurements.push(`${name}: ${text}`);
            if (/^(?:general|material\s*&\s*colou?r)$/i.test(section) && /^(?:model number|finish colou?r)$/i.test(name) && text) variants.add(text);
          }
        }
      } else if (key !== "tracking" && key !== "action") walk(child, depth + 1);
    }
  }
  walk(state.widgetsData);
  return { measurements: [...new Set(measurements)], variant: [...variants].join(" · ").slice(0, 160) };
}
