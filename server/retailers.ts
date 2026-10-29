import type { ProductDraft } from "../src/product-types";
import { applySpecifications, createProductDraft } from "../src/product-domain";
import { StudioError } from "./types";

export type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
const AMAZON = new Set(["amazon.in", "www.amazon.in", "m.amazon.in"]);
const SHARES = new Set(["amzn.in", "amzn.to"]);
const FLIPKART = new Set([
  "flipkart.com",
  "www.flipkart.com",
  "m.flipkart.com",
  "dl.flipkart.com",
]);
const MAX_HTML_BYTES = 1_500_000;
export function normalizeRetailerUrl(raw: string): {
  url: URL;
  retailer: "amazon" | "flipkart";
  productId?: string;
} {
  if (typeof raw !== "string" || raw.length > 2048)
    throw new StudioError(
      400,
      "INVALID_URL",
      "Paste an Amazon India or Flipkart product link.",
    );
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new StudioError(
      400,
      "INVALID_URL",
      "Paste a complete HTTPS product link.",
    );
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    (!AMAZON.has(host) && !SHARES.has(host) && !FLIPKART.has(host))
  )
    throw new StudioError(
      400,
      "UNSUPPORTED_URL",
      "Use an HTTPS Amazon India or Flipkart product link.",
    );
  url.hash = "";
  const retailer = FLIPKART.has(host) ? "flipkart" : "amazon";
  const asin = url.pathname
    .match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]
    ?.toUpperCase();
  const pid = url.searchParams.get("pid") ?? undefined;
  if (asin) {
    url = new URL(`https://www.amazon.in/dp/${asin}`);
  } else if (retailer === "amazon" && !SHARES.has(host))
    throw new StudioError(
      400,
      "NOT_PRODUCT_URL",
      "Use the product page or its Share link.",
    );
  if (
    retailer === "flipkart" &&
    !pid &&
    !/\/p\/|^\/s\/|^\/dl\/|^\/r\//.test(url.pathname)
  )
    throw new StudioError(
      400,
      "NOT_PRODUCT_URL",
      "Use a Flipkart product page or Share link.",
    );
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|affid|affExt|tag$|ref_|otracker|lid$|marketplace$)/i.test(key))
      url.searchParams.delete(key);
  return { url, retailer, productId: asin ?? pid };
}
export async function readBounded(
  response: Response,
  max: number,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > max)
    throw new StudioError(
      413,
      "CONTENT_TOO_LARGE",
      "The source is too large to import.",
    );
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new StudioError(
          413,
          "CONTENT_TOO_LARGE",
          "The source is too large to import.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export async function fetchRetailerPage(
  raw: string,
  fetcher: Fetcher = fetch,
): Promise<{
  url: URL;
  html: string;
  retailer: "amazon" | "flipkart";
  productId?: string;
}> {
  let target = normalizeRetailerUrl(raw);
  const initialRetailer = target.retailer;
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 8000);
  try {
    for (let redirects = 0; redirects <= 4; redirects++) {
      const response = await fetcher(target.url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirects === 4)
          throw new StudioError(
            422,
            "PAGE_UNAVAILABLE",
            "This link could not be read. Paste its specifications or add a product photo.",
          );
        const next = normalizeRetailerUrl(new URL(location, target.url).href);
        if (next.retailer !== initialRetailer)
          throw new StudioError(
            400,
            "UNSAFE_REDIRECT",
            "The product link redirected outside its retailer.",
          );
        target = next;
        continue;
      }
      if (!response.ok)
        throw new StudioError(
          422,
          "PAGE_UNAVAILABLE",
          "We could not read this page. Paste its specifications or add a product photo to continue.",
        );
      const type = response.headers.get("content-type") ?? "";
      if (type && !/text\/html|application\/xhtml\+xml/.test(type))
        throw new StudioError(
          422,
          "PAGE_UNAVAILABLE",
          "This product page could not be read.",
        );
      const html = new TextDecoder().decode(
        await readBounded(response, MAX_HTML_BYTES),
      );
      if (/captcha|robot check|validatecaptcha|automated access/i.test(html))
        throw new StudioError(
          422,
          "PAGE_UNAVAILABLE",
          "We could not read this page. Paste its specifications or add a product photo to continue.",
        );
      return { ...target, html };
    }
  } finally {
    clearTimeout(timeout);
  }
  throw new StudioError(
    422,
    "PAGE_UNAVAILABLE",
    "This product page could not be read.",
  );
}
function text(value: unknown, max = 500): string {
  return typeof value === "string"
    ? value
        .replace(/<[^>]*>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";
}
function meta(html: string, key: string): string {
  for (const match of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const attrs = Object.fromEntries(
      [...match[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map((m) => [
        m[1].toLowerCase(),
        m[3],
      ]),
    );
    if (attrs.property === key || attrs.name === key)
      return text(attrs.content, 2048);
  }
  return "";
}
function imageUrl(raw: string, retailer: "amazon" | "flipkart"): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.port)
      return null;
    const h = u.hostname;
    const allowed =
      retailer === "amazon"
        ? h === "m.media-amazon.com" ||
          h.endsWith(".ssl-images-amazon.com") ||
          h.endsWith(".media-amazon.com")
        : h === "rukminim1.flixcart.com" ||
          h === "rukminim2.flixcart.com" ||
          h.endsWith(".flixcart.com");
    return allowed ? u.href : null;
  } catch {
    return null;
  }
}
function productJson(html: string): Record<string, unknown> | null {
  const found: Record<string, unknown>[] = [];
  function walk(value: unknown, depth = 0) {
    if (depth > 8 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.slice(0, 50).forEach((v) => walk(v, depth + 1));
      return;
    }
    const o = value as Record<string, unknown>;
    const type = o["@type"];
    if (type === "Product" || (Array.isArray(type) && type.includes("Product")))
      found.push(o);
    if (o["@graph"]) walk(o["@graph"], depth + 1);
  }
  for (const match of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      walk(JSON.parse(match[1]));
    } catch {
      /* optional malformed metadata */
    }
  }
  return found[0] ?? null;
}
export function extractProductMetadata(
  html: string,
  draft: ProductDraft,
): ProductDraft {
  const structured = productJson(html);
  const title =
    text(structured?.name) ||
    meta(html, "og:title") ||
    text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const rawImages = structured?.image;
  const imgs =
    typeof rawImages === "string"
      ? [rawImages]
      : Array.isArray(rawImages)
        ? rawImages.map((v) =>
            typeof v === "string" ? v : (v as Record<string, unknown>)?.url,
          )
        : rawImages && typeof rawImages === "object"
          ? [(rawImages as Record<string, unknown>).url]
          : [];
  imgs.push(meta(html, "og:image"));
  const images = [
    ...new Set(
      imgs
        .filter((x): x is string => typeof x === "string")
        .map((x) =>
          imageUrl(
            x,
            draft.source.retailer === "flipkart" ? "flipkart" : "amazon",
          ),
        )
        .filter((x): x is string => !!x),
    ),
  ]
    .slice(0, 6)
    .map((url, i) => ({
      id: `listing-${i}`,
      url,
      source: "listing" as const,
      generationAllowed: false,
    }));
  let next: ProductDraft = {
    ...draft,
    title: title || draft.title,
    images,
    selectedImageId: images[0]?.id,
  };
  const propTexts: string[] = [];
  if (structured) {
    for (const axis of ["width", "depth", "height"]) {
      const raw = structured[axis];
      if (raw && typeof raw === "object") {
        const q = raw as Record<string, unknown>,
          unit = q.unitText ?? q.unitCode;
        const units: Record<string, string> = {
          CMT: "cm",
          MTR: "m",
          INH: "in",
          FOT: "ft",
        };
        if (
          (typeof q.value === "number" || typeof q.value === "string") &&
          typeof unit === "string"
        )
          propTexts.push(`${axis}: ${q.value} ${units[unit] ?? unit}`);
      }
    }
    if (Array.isArray(structured.additionalProperty))
      for (const p of structured.additionalProperty.slice(0, 30)) {
        if (p && typeof p === "object") {
          const q = p as Record<string, unknown>;
          if (
            /^(?:product |assembled )?(?:width|depth|height|dimensions)$/i.test(
              text(q.name),
            )
          )
            propTexts.push(
              `${text(q.name)}: ${text(String(q.value ?? ""))} ${text(q.unitText)}`,
            );
        }
      }
  }
  // Product detail tables are common when structured metadata omits measurements.
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [
      ...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi),
    ].map((m) => text(m[1], 1000));
    if (
      cells.length >= 2 &&
      /^(?:product|item|assembled|overall|outer|external)\s+(?:width|depth|height|dimensions\b.*)$/i.test(
        cells[0],
      ) &&
      !/package|shipping|carton|packed/i.test(cells[0])
    )
      propTexts.push(`${cells[0]}: ${cells.slice(1).join(" ")}`);
  }
  // Only explicitly labelled assembled values are evidence; shipping/package values are never inferred.
  if (propTexts.length || title) {
    next = applySpecifications(next, [title, ...propTexts].join("\n"));
    for (const m of Object.values(next.dimensions))
      if (m.metres !== null) {
        m.origin = "listing";
        m.confirmed = false;
      }
  }
  return next;
}
export async function resolveProduct(
  input: { url?: string; specifications?: string; roomId: string },
  fetcher: Fetcher = fetch,
): Promise<{ product: ProductDraft; notice?: string }> {
  const submitted = input.url?.trim();
  let product = createProductDraft(input.roomId),
    notice: string | undefined;
  if (submitted) {
    const target = normalizeRetailerUrl(submitted);
    product.source = {
      retailer: target.retailer,
      submittedUrl: submitted,
      canonicalUrl: target.url.href,
      productId: target.productId,
    };
    try {
      const page = await fetchRetailerPage(submitted, fetcher);
      product.source.canonicalUrl = page.url.href;
      product.source.productId = page.productId;
      product = extractProductMetadata(page.html, product);
    } catch (error) {
      if (error instanceof StudioError && error.code === "UNSAFE_REDIRECT")
        throw error;
      notice =
        "We could not read this page. Paste its specifications or add a product photo to continue.";
    }
  }
  if (input.specifications?.trim()) {
    const previous = product.dimensions,
      applied = applySpecifications(product, input.specifications);
    for (const axis of ["width", "depth", "height"] as const) {
      const warnings = applied.specificationWarnings ?? [];
      const invalidAxis = warnings.some(
        (w) =>
          w.toLowerCase().includes(`conflicting ${axis}`) ||
          w.toLowerCase().startsWith(`${axis} is outside`),
      );
      if (applied.dimensions[axis].metres === null && !invalidAxis)
        applied.dimensions[axis] = previous[axis];
    }
    product = applied;
  }
  return { product, notice };
}
