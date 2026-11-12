import { describe, it, expect, vi, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleStudioRequest } from "../server/studio";
import { StudioRepository, type AssetRow } from "../server/repository";
import {
  fetchRetailerPage,
  normalizeRetailerUrl,
  resolveProduct,
} from "../server/retailers";
import { startGeneration, pollGeneration } from "../server/generation";
import { MeshyProvider, MESHY_RATE } from "../server/provider";
import { createProductDraft, applySpecifications } from "../src/product-domain";
import type { Bucket, Database, Statement, StudioEnv } from "../server/types";
import type { ModelProvider } from "../server/provider";

const schema = `CREATE TABLE studio_products(id TEXT PRIMARY KEY,owner_id TEXT,room_id TEXT,draft_json TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE studio_operations(id TEXT PRIMARY KEY,owner_id TEXT,room_id TEXT,product_id TEXT,record_json TEXT,submitted_at TEXT);
CREATE TABLE studio_assets(id TEXT PRIMARY KEY,owner_id TEXT,room_id TEXT,product_id TEXT,object_key TEXT,mime TEXT,size INTEGER,name TEXT,generation_allowed INTEGER,created_at TEXT);
CREATE TABLE studio_accounts(owner_id TEXT PRIMARY KEY,allowance_credits INTEGER DEFAULT 0,reserved_credits INTEGER DEFAULT 0,consumed_credits INTEGER DEFAULT 0);
CREATE TABLE studio_jobs(id TEXT PRIMARY KEY,owner_id TEXT,product_id TEXT,room_id TEXT,draft_revision INTEGER,provider_task_id TEXT,operation_id TEXT,idempotency_key TEXT,request_hash TEXT,status TEXT,job_json TEXT,quoted_credits INTEGER,reservation_state TEXT,created_at TEXT,updated_at TEXT,UNIQUE(owner_id,idempotency_key));`;
const python = `import sqlite3,json,sys
p=json.load(sys.stdin)
c=sqlite3.connect(p['file']);c.row_factory=sqlite3.Row
out=[]
try:
 if 'schema' in p:c.executescript(p['schema'])
 for q in p.get('queries',[]):
  cur=c.execute(q['sql'],q.get('args',[]))
  rows=[dict(r) for r in cur.fetchall()] if cur.description else []
  out.append({'results':rows,'meta':{'changes':max(0,cur.rowcount)},'success':True})
 c.commit();print(json.dumps(out))
except Exception:
 c.rollback();raise
finally:c.close()
`;
const directories: string[] = [];
class SqliteD1 implements Database {
  readonly file: string;
  constructor() {
    const dir = mkdtempSync(path.join(tmpdir(), "roomshift-server-test-"));
    directories.push(dir);
    this.file = path.join(dir, "db.sqlite");
    this.execute([], schema);
  }
  execute(
    queries: { sql: string; args: unknown[] }[],
    initialSchema?: string,
  ): {
    results: Record<string, unknown>[];
    meta: { changes: number };
    success: boolean;
  }[] {
    return JSON.parse(
      execFileSync("python3", ["-c", python], {
        input: JSON.stringify({
          file: this.file,
          queries,
          schema: initialSchema,
        }),
        encoding: "utf8",
      }),
    );
  }
  prepare(sql: string): Statement {
    return new SqliteStatement(this, sql);
  }
  async batch<T = unknown>(statements: Statement[]): Promise<T[]> {
    return this.execute(
      statements.map((s) => ({
        sql: (s as SqliteStatement).sql,
        args: (s as SqliteStatement).args,
      })),
    ) as T[];
  }
}
class SqliteStatement implements Statement {
  args: unknown[] = [];
  constructor(
    readonly db: SqliteD1,
    readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.args = values;
    return this;
  }
  async first<T = Record<string, unknown>>() {
    return (this.db.execute([{ sql: this.sql, args: this.args }])[0]
      .results[0] ?? null) as T | null;
  }
  async all<T = Record<string, unknown>>() {
    return {
      results: this.db.execute([{ sql: this.sql, args: this.args }])[0]
        .results as T[],
    };
  }
  async run() {
    return this.db.execute([{ sql: this.sql, args: this.args }])[0];
  }
}
class MemoryBucket implements Bucket {
  files = new Map<string, Uint8Array>();
  async put(key: string, value: ArrayBuffer | Uint8Array | ReadableStream) {
    if (value instanceof ReadableStream) throw new Error("unused");
    this.files.set(
      key,
      new Uint8Array(value instanceof Uint8Array ? value : value.slice(0)),
    );
  }
  async get(key: string) {
    const bytes = this.files.get(key);
    return bytes
      ? {
          body: new Response(bytes.slice().buffer as ArrayBuffer).body!,
          arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
        }
      : null;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}
function request(
  pathname: string,
  method = "GET",
  body?: unknown,
  owner?: string,
) {
  return new Request(`https://roomshift.example${pathname}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(owner ? { "oai-authenticated-user-id": owner } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
function draft() {
  const p = applySpecifications(
    createProductDraft("room-a"),
    "Width: 150 cm\nDepth: 70 cm\nHeight: 75 cm",
  );
  p.title = "A desk";
  p.kind = "desk";
  for (const axis of Object.values(p.dimensions)) axis.confirmed = true;
  return p;
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("public studio API boundaries", () => {
  it("hard-pauses generation before network, storage or client overrides, including when flags and a key are present", async () => {
    const network = vi.fn(() => {
      throw new Error("Network must not run");
    });
    vi.stubGlobal("fetch", network);
    const response = await handleStudioRequest(
      request(
        "/api/generations",
        "POST",
        { enabled: true, provider: "other", model: "other", allowance: 999 },
        "alice",
      ),
      {
        STUDIO_PAID_GENERATION_ENABLED: "true",
        MESHY_API_KEY: "not-a-live-key-for-tests",
      },
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as any).error.code).toBe(
      "GENERATION_PAUSED",
    );
    expect(network).not.toHaveBeenCalled();
    const session: any = await (
      await handleStudioRequest(request("/api/studio/session"), {})
    ).json();
    expect(session.generation.enabled).toBe(false);
    expect(session.generation.reason).toBe(
      "Detailed AI generation is paused. You can try dimensions or import a 3D model.",
    );
    expect(session.user).toBeNull();
  });
  it("accepts manual anonymous specifications with local observed accounting and never invokes a model", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    const response = await handleStudioRequest(
      request("/api/products/resolve", "POST", {
        roomId: "room-a",
        specifications: "Width: 150.25 cm\nDepth: 70 cm\nHeight: 75 cm",
      }),
      {},
    );
    expect(response.status).toBe(200);
    const result: any = await response.json();
    expect(result.product.dimensions.width.metres).toBe(1.5025);
    expect(result.operation.cost.basis).toBe("local");
    expect(result.operation.timing.source).toBe("observed");
    expect(network).not.toHaveBeenCalled();
  });
  it("requires owner identity for saved libraries and rejects cross-origin and invalid input before fetching", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    expect(
      (await handleStudioRequest(request("/api/products"), {})).status,
    ).toBe(401);
    const cross = request("/api/products/resolve", "POST", {
      roomId: "room-a",
      specifications: "Width: 150 cm",
    });
    cross.headers.set("Origin", "https://attacker.example");
    expect((await handleStudioRequest(cross, {})).status).toBe(403);
    expect(
      (
        await handleStudioRequest(
          request("/api/products/resolve", "POST", {
            roomId: "room-a",
            url: "https://127.0.0.1/admin",
          }),
          {},
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleStudioRequest(
          request("/api/products/resolve", "POST", {
            roomId: "room-a",
            specifications: "x".repeat(21_000),
          }),
          {},
        )
      ).status,
    ).toBe(400);
    expect(network).not.toHaveBeenCalled();
  });
  it("keeps saved products and operations owner scoped and ignores client owner identifiers", async () => {
    const DB = new SqliteD1(),
      env = { DB },
      product = draft();
    expect(
      (
        await handleStudioRequest(
          request(
            "/api/products",
            "POST",
            { ...product, ownerId: "bob" },
            "alice",
          ),
          env,
        )
      ).status,
    ).toBe(200);
    const alice: any = await (
      await handleStudioRequest(
        request("/api/products?roomId=room-a", "GET", undefined, "alice"),
        env,
      )
    ).json();
    const bob: any = await (
      await handleStudioRequest(
        request("/api/products?ownerId=alice", "GET", undefined, "bob"),
        env,
      )
    ).json();
    expect(alice.products).toHaveLength(1);
    expect(bob.products).toEqual([]);
    const conflict = await handleStudioRequest(
      request("/api/products", "POST", product, "bob"),
      env,
    );
    expect(conflict.status).toBe(409);
    await handleStudioRequest(
      request(
        "/api/products/resolve",
        "POST",
        { roomId: "room-a", specifications: "Width: 150 cm" },
        "alice",
      ),
      env,
    );
    const ops: any = await (
      await handleStudioRequest(
        request("/api/operations?ownerId=alice", "GET", undefined, "bob"),
        env,
      )
    ).json();
    expect(ops.operations).toEqual([]);
  });
  it("stores uploaded files privately, refuses malformed models, and prevents listing generation consent forgery", async () => {
    const DB = new SqliteD1(),
      BUCKET = new MemoryBucket(),
      env = { DB, BUCKET };
    const form = new FormData();
    form.set("roomId", "room-a");
    form.set(
      "file",
      new File(
        [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])],
        "photo.png",
        { type: "image/png" },
      ),
    );
    form.set("generationAllowed", "true");
    const uploaded = await handleStudioRequest(
      new Request("https://roomshift.example/api/assets", {
        method: "POST",
        headers: { "oai-authenticated-user-id": "alice" },
        body: form,
      }),
      env,
    );
    expect(uploaded.status).toBe(201);
    const asset: any = await uploaded.json();
    const own = await handleStudioRequest(
      request(`/api/assets/${asset.id}`, "GET", undefined, "alice"),
      env,
    );
    expect(own.status).toBe(200);
    expect(own.headers.get("cache-control")).toBe("private, no-store");
    expect(
      (
        await handleStudioRequest(
          request(`/api/assets/${asset.id}`, "GET", undefined, "bob"),
          env,
        )
      ).status,
    ).toBe(404);
    const p = draft();
    p.images = [
      {
        id: "listing-a",
        url: "https://m.media-amazon.com/images/I/example.jpg",
        source: "listing",
        generationAllowed: true,
      },
    ];
    const saved: any = await (
      await handleStudioRequest(
        request("/api/products", "POST", p, "alice"),
        env,
      )
    ).json();
    expect(saved.product.images[0].generationAllowed).toBe(false);
    const bad = new FormData();
    bad.set("roomId", "room-a");
    bad.set("file", new File(["bad glb"], "fake.glb"));
    expect(
      (
        await handleStudioRequest(
          new Request("https://roomshift.example/api/assets", {
            method: "POST",
            headers: { "oai-authenticated-user-id": "alice" },
            body: bad,
          }),
          env,
        )
      ).status,
    ).toBe(400);
  });
});

describe("bounded retailer retrieval", () => {
  it("normalizes supported canonical/share URLs and rejects lookalike, private and arbitrary targets", () => {
    expect(
      normalizeRetailerUrl(
        "https://www.amazon.in/name/dp/B012345678?tag=tracking",
      ).url.href,
    ).toBe("https://www.amazon.in/dp/B012345678");
    expect(normalizeRetailerUrl("https://amzn.in/d/abc").retailer).toBe(
      "amazon",
    );
    expect(
      normalizeRetailerUrl("https://www.flipkart.com/desk/p/itm123?pid=ABC")
        .productId,
    ).toBe("ABC");
    for (const u of [
      "http://www.amazon.in/dp/B012345678",
      "https://amazon.in.evil.example/dp/B012345678",
      "https://amazon.in@127.0.0.1/",
      "https://amazon.in:4430/dp/B012345678",
      "https://169.254.169.254/",
      "https://www.amazon.in/",
    ])
      expect(() => normalizeRetailerUrl(u)).toThrow();
  });
  it("validates every redirect before fetching and never follows a retailer redirect to a private host", async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/metadata" },
      }),
    );
    await expect(
      fetchRetailerPage("https://amzn.in/d/abc", f),
    ).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][1].redirect).toBe("manual");
  });
  it("returns an honest partial draft on blocked pages, preserving the submitted URL and manual evidence", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(new Response("Robot Check", { status: 403 }));
    const result: any = await resolveProduct(
      {
        roomId: "room-a",
        url: "https://amzn.in/d/abc",
        specifications: "Width: 150 cm",
      },
      f,
    );
    expect(result.notice).toContain("could not read");
    expect(result.product.source.submittedUrl).toBe("https://amzn.in/d/abc");
    expect(result.product.dimensions.width.metres).toBe(1.5);
    expect(result.product.dimensions.depth.metres).toBeNull();
  });
  it("extracts explicit metadata evidence without treating images as permission or package sizes as furniture sizes", async () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"Oak desk","width":{"value":150,"unitCode":"CMT"},"depth":{"value":70,"unitCode":"CMT"},"image":"https://m.media-amazon.com/images/I/desk.jpg","additionalProperty":[{"name":"Package dimensions","value":"200 x 100 x 30 cm"}]}</script>`;
    const result: any = await resolveProduct(
      { roomId: "room-a", url: "https://www.amazon.in/dp/B012345678" },
      vi
        .fn()
        .mockResolvedValue(
          new Response(html, { headers: { "Content-Type": "text/html" } }),
        ),
    );
    expect(result.product.title).toBe("Oak desk");
    expect(result.product.dimensions.width).toMatchObject({
      metres: 1.5,
      origin: "listing",
      confirmed: false,
    });
    expect(result.product.dimensions.height.metres).toBeNull();
    expect(result.product.images[0].generationAllowed).toBe(false);
  });
  it("reads labelled assembled table sizes and preserves known axes when pasted specifications fill only a missing axis", async () => {
    const html =
      "<title>Oak desk</title><table><tr><th>Product Dimensions</th><td>70D x 150W x 75H cm</td></tr><tr><th>Package dimensions</th><td>200 x 100 x 40 cm</td></tr></table>";
    const result = await resolveProduct(
      {
        roomId: "room-a",
        url: "https://www.amazon.in/dp/B012345678",
        specifications: "Height: 80 cm",
      },
      vi
        .fn()
        .mockResolvedValue(
          new Response(html, { headers: { "content-type": "text/html" } }),
        ),
    );
    expect(result.product.kind).toBe("desk");
    expect(result.product.dimensions.width.metres).toBe(1.5);
    expect(result.product.dimensions.depth.metres).toBe(0.7);
    expect(result.product.dimensions.height.metres).toBe(0.8);
  });
  it("caps declared source bytes before consuming a large body", async () => {
    await expect(
      fetchRetailerPage(
        "https://www.amazon.in/dp/B012345678",
        vi.fn().mockResolvedValue(
          new Response("tiny", {
            headers: {
              "content-length": "3000001",
              "content-type": "text/html",
            },
          }),
        ),
      ),
    ).rejects.toThrow("too large");
  });
});

async function prepared() {
  const DB = new SqliteD1(),
    BUCKET = new MemoryBucket(),
    repo = new StudioRepository(DB, "alice"),
    p = draft(),
    asset: AssetRow = {
      id: "image-a",
      owner_id: "alice",
      room_id: p.roomId,
      product_id: p.id,
      object_key: "private-image",
      mime: "image/png",
      size: 9,
      name: "my-photo.png",
      generation_allowed: 1,
      created_at: new Date().toISOString(),
    };
  await repo.saveAsset(asset);
  await BUCKET.put(
    asset.object_key,
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]),
  );
  p.images = [
    {
      id: "image-a",
      assetId: asset.id,
      url: "/api/assets/image-a",
      source: "upload",
      generationAllowed: true,
    },
  ];
  p.selectedImageId = "image-a";
  await repo.saveProduct(p);
  await DB.prepare(
    "INSERT INTO studio_accounts(owner_id,allowance_credits,reserved_credits,consumed_credits) VALUES (?,?,0,0)",
  )
    .bind("alice", 100)
    .run();
  return { DB, BUCKET, repo, p };
}
describe("generation engine with mocked providers only", () => {
  it("reserves once, reuses idempotent requests, and rejects stale-key changes without another provider call", async () => {
    const { repo, BUCKET, p } = await prepared(),
      provider: ModelProvider = {
        create: vi
          .fn()
          .mockResolvedValue({ id: "mock-task", status: "queued" }),
        get: vi.fn(),
        download: vi.fn(),
      };
    const a = await startGeneration(
        repo,
        BUCKET,
        p,
        "image-a",
        "unique-request-a",
        provider,
      ),
      b = await startGeneration(
        repo,
        BUCKET,
        p,
        "image-a",
        "unique-request-a",
        provider,
      );
    expect(a.id).toBe(b.id);
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect((await repo.account())?.reserved_credits).toBe(MESHY_RATE.credits);
    await expect(
      startGeneration(
        repo,
        BUCKET,
        { ...p, revision: p.revision + 1 },
        "image-a",
        "unique-request-a",
        provider,
      ),
    ).rejects.toThrow("already used");
    expect(provider.create).toHaveBeenCalledTimes(1);
  });
  it("refuses missing allowance and impermitted images before calling the mock provider", async () => {
    const { repo, BUCKET, p } = await prepared(),
      provider: ModelProvider = {
        create: vi.fn(),
        get: vi.fn(),
        download: vi.fn(),
      };
    await repo.db
      .prepare(
        "UPDATE studio_accounts SET allowance_credits = 0 WHERE owner_id = ?",
      )
      .bind("alice")
      .run();
    await expect(
      startGeneration(repo, BUCKET, p, "image-a", "unique-request-a", provider),
    ).rejects.toThrow("allowance");
    expect(provider.create).not.toHaveBeenCalled();
    await expect(
      startGeneration(
        repo,
        BUCKET,
        {
          ...p,
          images: [
            {
              id: "listing-a",
              url: "https://m.media-amazon.com/a.jpg",
              source: "listing",
              generationAllowed: true,
            },
          ],
        },
        "listing-a",
        "unique-request-b",
        provider,
      ),
    ).rejects.toThrow("permitted");
  });
  it("holds an unknown billing reservation after submission failure and never automatically duplicates the provider task", async () => {
    const { repo, BUCKET, p } = await prepared(),
      provider: ModelProvider = {
        create: vi
          .fn()
          .mockRejectedValue(
            new Error("timeout may have happened after billing"),
          ),
        get: vi.fn(),
        download: vi.fn(),
      };
    const job = await startGeneration(
      repo,
      BUCKET,
      p,
      "image-a",
      "unique-request-a",
      provider,
    );
    expect(job.status).toBe("unknown");
    await startGeneration(
      repo,
      BUCKET,
      p,
      "image-a",
      "unique-request-a",
      provider,
    );
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect((await repo.account())?.reserved_credits).toBe(MESHY_RATE.credits);
  });
  it("releases a provider-reported zero-credit failure once and never mutates saved products", async () => {
    const { repo, BUCKET, p } = await prepared(),
      original = await repo.product(p.id),
      provider: ModelProvider = {
        create: vi
          .fn()
          .mockResolvedValue({ id: "mock-task", status: "queued" }),
        get: vi
          .fn()
          .mockResolvedValue({ id: "mock-task", status: "failed", credits: 0 }),
        download: vi.fn(),
      };
    const job = await startGeneration(
      repo,
      BUCKET,
      p,
      "image-a",
      "unique-request-a",
      provider,
    );
    expect((await pollGeneration(repo, BUCKET, job.id, provider)).status).toBe(
      "failed",
    );
    await pollGeneration(repo, BUCKET, job.id, provider);
    expect((await repo.account())?.reserved_credits).toBe(0);
    expect((await repo.account())?.consumed_credits).toBe(0);
    expect(await repo.product(p.id)).toEqual(original);
  });
  it("validates and retains a successful mocked GLB privately without changing saved products or charging twice", async () => {
    const { repo, BUCKET, p } = await prepared(),
      original = await repo.product(p.id),
      file = readFileSync(
        new URL("../public/assets/furniture.glb", import.meta.url),
      ),
      bytes = file.buffer.slice(
        file.byteOffset,
        file.byteOffset + file.byteLength,
      ) as ArrayBuffer;
    const provider: ModelProvider = {
      create: vi.fn().mockResolvedValue({ id: "mock-task", status: "queued" }),
      get: vi.fn().mockResolvedValue({
        id: "mock-task",
        status: "succeeded",
        modelUrl: "https://assets.meshy.ai/model.glb",
      }),
      download: vi.fn().mockResolvedValue(bytes),
    };
    const job = await startGeneration(
        repo,
        BUCKET,
        p,
        "image-a",
        "unique-request-a",
        provider,
      ),
      done = await pollGeneration(repo, BUCKET, job.id, provider);
    expect(done.status).toBe("succeeded");
    expect(done.outputAssetId).toBeTruthy();
    expect((await repo.asset(done.outputAssetId!))?.mime).toBe(
      "model/gltf-binary",
    );
    expect(await repo.product(p.id)).toEqual(original);
    await pollGeneration(repo, BUCKET, job.id, provider);
    expect(provider.download).toHaveBeenCalledTimes(1);
    expect((await repo.account())?.consumed_credits).toBe(MESHY_RATE.credits);
    expect((await repo.account())?.reserved_credits).toBe(0);
    expect((await repo.operation(job.operationId))?.cost.basis).toBe(
      "estimated",
    );
    expect(
      (await repo.operation(job.operationId))?.usage.credits,
    ).toBeUndefined();
    expect((await repo.operation(job.operationId))?.estimate?.credits).toBe(
      MESHY_RATE.credits,
    );
    expect(
      await new StudioRepository(repo.db, "bob").asset(done.outputAssetId!),
    ).toBeNull();
  });
  it("rejects malformed provider output but retains its charge as an estimate rather than pretending processing was free", async () => {
    const { repo, BUCKET, p } = await prepared(),
      provider: ModelProvider = {
        create: vi
          .fn()
          .mockResolvedValue({ id: "mock-task", status: "queued" }),
        get: vi.fn().mockResolvedValue({
          id: "mock-task",
          status: "succeeded",
          modelUrl: "https://assets.meshy.ai/model.glb",
        }),
        download: vi
          .fn()
          .mockResolvedValue(new TextEncoder().encode("not a GLB").buffer),
      };
    const job = await startGeneration(
        repo,
        BUCKET,
        p,
        "image-a",
        "unique-request-a",
        provider,
      ),
      done = await pollGeneration(repo, BUCKET, job.id, provider);
    expect(done.status).toBe("failed");
    expect(done.outputAssetId).toBeUndefined();
    expect((await repo.operation(job.operationId))?.cost.basis).toBe(
      "estimated",
    );
    expect(
      (await repo.operation(job.operationId))?.usage.credits,
    ).toBeUndefined();
    expect((await repo.operation(job.operationId))?.estimate?.credits).toBe(
      MESHY_RATE.credits,
    );
    expect((await repo.account())?.consumed_credits).toBe(MESHY_RATE.credits);
  });
  it("does not send a provider credential to download hosts and rejects a private asset redirect", async () => {
    const network = vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/secret" },
        }),
      ),
      provider = new MeshyProvider("not-a-live-key", network);
    await expect(
      provider.download("https://assets.meshy.ai/file.glb"),
    ).rejects.toThrow("unsupported asset");
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0][1].headers).toBeUndefined();
  });
});
