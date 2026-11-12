import { readBounded, type Fetcher } from "./retailers";
import { StudioError } from "./types";
export const MESHY_MODEL = "meshy-6";
export const MESHY_RATE = {
  id: "meshy-6-image-textured-2k-2026-10-29",
  credits: 30,
  unit: "Meshy API credits",
  source: "https://docs.meshy.ai/en/api/pricing",
  checkedAt: "2026-10-29",
  basis: "estimated" as const,
};
export interface ProviderTask {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "unknown";
  modelUrl?: string;
  credits?: number;
  startedAt?: string;
  finishedAt?: string;
}
export interface ModelProvider {
  create(imageDataUri: string, operationId: string): Promise<ProviderTask>;
  get(taskId: string): Promise<ProviderTask>;
  download(url: string): Promise<ArrayBuffer>;
}
const API = "https://api.meshy.ai/openapi/v1/image-to-3d";
function safeTaskId(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    throw new StudioError(
      502,
      "PROVIDER_OUTPUT_INVALID",
      "The model service returned an invalid task.",
    );
  return id;
}
function assetUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new StudioError(
      502,
      "PROVIDER_OUTPUT_INVALID",
      "The model service returned an invalid asset.",
    );
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !["assets.meshy.ai", "cdn.meshy.ai", "api.meshy.ai"].includes(u.hostname)
  )
    throw new StudioError(
      502,
      "PROVIDER_OUTPUT_INVALID",
      "The model service returned an unsupported asset source.",
    );
  return u;
}
export class MeshyProvider implements ModelProvider {
  constructor(
    private key: string,
    private fetcher: Fetcher = fetch,
  ) {}
  private async api(
    url: string,
    init: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    if (!url.startsWith(`${API}/`) && url !== API)
      throw new StudioError(
        502,
        "PROVIDER_URL_INVALID",
        "The model service request could not be made.",
      );
    const response = await this.fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.key}`,
        ...init.headers,
      },
    });
    if (!response.ok)
      throw new StudioError(
        502,
        "PROVIDER_REQUEST_FAILED",
        "The model service could not finish this request. Your size preview is still available.",
      );
    try {
      return JSON.parse(
        new TextDecoder().decode(await readBounded(response, 100_000)),
      ) as Record<string, unknown>;
    } catch {
      throw new StudioError(
        502,
        "PROVIDER_OUTPUT_INVALID",
        "The model service returned an unreadable response.",
      );
    }
  }
  async create(
    imageDataUri: string,
    operationId: string,
  ): Promise<ProviderTask> {
    if (
      !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
        imageDataUri,
      )
    )
      throw new StudioError(
        400,
        "IMAGE_REQUIRED",
        "Choose a permitted product photo.",
      );
    const data = await this.api(API, {
      method: "POST",
      headers: {
        "X-Meshy-Metadata": JSON.stringify({ operation: operationId }),
      },
      body: JSON.stringify({
        image_url: imageDataUri,
        ai_model: MESHY_MODEL,
        model_type: "standard",
        geometry_resolution: "standard",
        should_texture: true,
        texture_resolution: "2k",
        enable_pbr: true,
        image_enhancement: false,
        auto_size: false,
        should_remesh: true,
        target_polycount: 40000,
        target_formats: ["glb"],
      }),
    });
    return { id: safeTaskId(String(data.result ?? "")), status: "queued" };
  }
  async get(id: string): Promise<ProviderTask> {
    const data = await this.api(`${API}/${safeTaskId(id)}`),
      statuses: Record<string, ProviderTask["status"]> = {
        PENDING: "queued",
        IN_PROGRESS: "running",
        SUCCEEDED: "succeeded",
        FAILED: "failed",
        CANCELED: "failed",
      };
    const rawUrl = (data.model_urls as Record<string, unknown> | undefined)
      ?.glb;
    return {
      id,
      status: statuses[String(data.status)] ?? "unknown",
      ...(typeof rawUrl === "string"
        ? { modelUrl: assetUrl(rawUrl).href }
        : {}),
      ...(typeof data.consumed_credits === "number" &&
      Number.isFinite(data.consumed_credits) &&
      data.consumed_credits >= 0
        ? { credits: data.consumed_credits }
        : {}),
    };
  }
  async download(raw: string): Promise<ArrayBuffer> {
    let url = assetUrl(raw);
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 30000);
    try {
      for (let i = 0; i < 4; i++) {
        const response = await this.fetcher(url, {
          redirect: "manual",
          signal: controller.signal,
        });
        // Never forward the provider bearer token to asset hosts or redirects.
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location) break;
          url = assetUrl(new URL(location, url).href);
          continue;
        }
        if (!response.ok) break;
        const bytes = await readBounded(response, 30_000_000);
        return bytes.buffer as ArrayBuffer;
      }
    } finally {
      clearTimeout(timer);
    }
    throw new StudioError(
      502,
      "MODEL_DOWNLOAD_FAILED",
      "The model could not be downloaded. Your size preview is still available.",
    );
  }
}
