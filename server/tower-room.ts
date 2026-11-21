import { z } from 'zod';
import type { FurnitureKind } from '../src/tower/model';

export const CODE_RE = /^[a-z0-9]{10}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const MAX_BYTES = 32 * 1024;
export const MAX_GUESTS = 12;
export const HOST_RATE = 30;
export const GUEST_RATE = 10;
export const HOST_GONE_MS = 10 * 60_000;

const KINDS = ['sofa', 'armchair', 'coffee-table', 'tv-unit', 'rug', 'dining-table', 'dining-chair', 'bed-double', 'bed-queen', 'bed-single', 'wardrobe', 'side-table', 'desk', 'office-chair', 'bookshelf', 'plant', 'floor-lamp', 'cat-tree', 'crib', 'bean-bag', 'shoe-rack'] as const satisfies readonly FurnitureKind[];
const num = z.number().finite().min(-1e5).max(1e5);
const vec = z.tuple([num, num, num]);
const poseSchema = z.object({ p: vec, t: vec }).strict();
const text = (max: number) => z.string().max(max);
const pieceSchema = z.object({
  id: text(60), kind: z.enum(KINDS), roomId: text(60), x: num, y: num, rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  w: num, d: num, h: num, priceINR: num, color: text(24),
}).strict();
const briefSchema = z.object({
  occupants: num, budgetINR: num, style: z.enum(['warm-minimal', 'scandi', 'indian-modern', 'industrial']), wfh: num, kids: num, pets: z.array(text(24)).max(6), notes: text(600),
}).strict();
const issueSchema = z.object({
  pieceId: text(60).optional(), roomId: text(60).optional(),
  kind: z.enum(['overlap', 'blocks-door', 'tight-walkway', 'outside-room', 'over-budget', 'missing-need']), message: text(400),
}).strict();
const furnishSchema = z.object({
  unitId: text(20), brief: briefSchema, pieces: z.array(pieceSchema).max(120), costINR: num, issues: z.array(issueSchema).max(40), ok: z.boolean(),
}).strict();
const stateSchema = z.object({
  mode: z.enum(['tower', 'unit']), floor: z.number().int().min(1).max(200).nullable(), unitId: text(20).nullable(), furnish: furnishSchema.nullable(), key: text(80),
  reply: text(2000).nullable().optional(), whys: z.array(text(500)).max(12).optional(),
}).strict();

const hostMessage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('state'), state: stateSchema }).strict(),
  z.object({ t: z.literal('pose'), pose: poseSchema }).strict(),
]);
const guestMessage = z.object({ t: z.literal('pose'), pose: poseSchema, exploring: z.boolean() }).strict();

export type Role = 'host' | 'guest';
export type Pose = z.infer<typeof poseSchema>;
export type RoomState = z.infer<typeof stateSchema>;
export type ClientMessage = z.infer<typeof hostMessage> | z.infer<typeof guestMessage>;
export interface Attachment { id: string; role: Role; label: string; exploring: boolean; pose?: Pose }
export interface PeerInfo { id: string; role: Role; label: string }

export type Parsed = { ok: true; msg: ClientMessage } | { ok: false; reason: 'too-large' | 'not-text' | 'invalid' };

export function parseClientMessage(role: Role, raw: unknown): Parsed {
  if (typeof raw !== 'string') return { ok: false, reason: 'not-text' };
  if (raw.length > MAX_BYTES || new TextEncoder().encode(raw).length > MAX_BYTES) return { ok: false, reason: 'too-large' };
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return { ok: false, reason: 'invalid' }; }
  const result = (role === 'host' ? hostMessage : guestMessage).safeParse(json);
  return result.success ? { ok: true, msg: result.data } : { ok: false, reason: 'invalid' };
}

export interface Bucket { tokens: number; at: number }
export function takeToken(bucket: Bucket | undefined, now: number, perSecond: number): { allowed: boolean; bucket: Bucket } {
  const prev = bucket ?? { tokens: perSecond, at: now };
  const tokens = Math.min(perSecond, prev.tokens + Math.max(0, now - prev.at) / 1000 * perSecond);
  if (tokens < 1) return { allowed: false, bucket: { tokens, at: now } };
  return { allowed: true, bucket: { tokens: tokens - 1, at: now } };
}

export function originAllowed(origin: string | null, requestUrl: string): boolean {
  if (!origin) return false;
  let o: URL, r: URL;
  try { o = new URL(origin); r = new URL(requestUrl); } catch { return false; }
  if (o.host === r.host) return true;
  const local = new Set(['127.0.0.1', 'localhost']);
  return local.has(o.hostname) && local.has(r.hostname) && o.port === r.port;
}

export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type Outgoing =
  | { t: 'welcome'; you: { id: string; role: Role }; state?: RoomState; hostPose?: Pose; hostPresent: boolean; peers: PeerInfo[] }
  | { t: 'state'; state: RoomState }
  | { t: 'pose'; from: string; role: Role; pose: Pose; exploring?: boolean }
  | { t: 'peers'; peers: PeerInfo[] }
  | { t: 'host-left' };

export interface Relay { to: 'guests' | 'host'; message: Outgoing; store?: { state?: RoomState } }

export function relay(from: Attachment, msg: ClientMessage): Relay {
  if (from.role === 'host') {
    if (msg.t === 'state') return { to: 'guests', message: { t: 'state', state: msg.state }, store: { state: msg.state } };
    return { to: 'guests', message: { t: 'pose', from: from.id, role: 'host', pose: msg.pose } };
  }
  const pose = (msg as z.infer<typeof guestMessage>);
  return { to: 'host', message: { t: 'pose', from: from.id, role: 'guest', pose: pose.pose, exploring: pose.exploring } };
}

export const peersOf = (list: Attachment[]): PeerInfo[] => list.map(a => ({ id: a.id, role: a.role, label: a.label }));

export interface RouteEnv { TOWER_ROOM?: { idFromName(name: string): unknown; get(id: never): { fetch(request: Request): Promise<Response> } } }

export async function routeTowerRoom(request: Request, env: RouteEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const match = /^\/api\/tower-room\/([^/]*)\/?$/.exec(url.pathname);
  if (!match) return null;
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426, headers: { Upgrade: 'websocket' } });
  const code = match[1];
  if (!CODE_RE.test(code)) return new Response('Not found', { status: 404 });
  if (!originAllowed(request.headers.get('Origin'), request.url)) return new Response('Forbidden', { status: 403 });
  const ns = env.TOWER_ROOM;
  if (!ns) return new Response('Sharing is not available', { status: 503 });
  const role = url.searchParams.get('role');
  if (role !== 'host' && role !== 'guest') return new Response('Bad request', { status: 400 });
  if (role === 'host' && !SECRET_RE.test(url.searchParams.get('secret') ?? '')) return new Response('Bad request', { status: 400 });
  return ns.get(ns.idFromName(code) as never).fetch(request);
}

interface Socket { send(data: string): void; close(code?: number, reason?: string): void; serializeAttachment(value: unknown): void; deserializeAttachment(): unknown }
interface Storage { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void>; deleteAll(): Promise<void>; setAlarm(time: number): Promise<void>; deleteAlarm(): Promise<void> }
interface RoomContext { storage: Storage; acceptWebSocket(ws: WebSocket): void; getWebSockets(): WebSocket[] }

const id = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => (b % 36).toString(36)).join('');
const asSocket = (ws: WebSocket) => ws as unknown as Socket;
const attachmentOf = (ws: WebSocket) => asSocket(ws).deserializeAttachment() as Attachment | null;

export class TowerRoom {
  private buckets = new Map<string, Bucket>();
  constructor(private readonly ctx: RoomContext, _env?: unknown) {}

  private members(): { ws: WebSocket; a: Attachment }[] {
    return this.ctx.getWebSockets().flatMap(ws => { const a = attachmentOf(ws); return a ? [{ ws, a }] : []; });
  }
  private send(ws: WebSocket, message: Outgoing) { try { asSocket(ws).send(JSON.stringify(message)); } catch { } }
  private announce() {
    const list = this.members();
    const peers = peersOf(list.map(m => m.a));
    for (const m of list) this.send(m.ws, { t: 'peers', peers });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    const stored = await this.ctx.storage.get<string>('secret');
    const list = this.members();
    let attachment: Attachment;
    if (role === 'host') {
      const secret = url.searchParams.get('secret') ?? '';
      if (stored === undefined) await this.ctx.storage.put('secret', secret);
      else if (!sameSecret(stored, secret)) return new Response('Wrong host secret', { status: 403 });
      attachment = { id: id(), role: 'host', label: 'Host', exploring: false };
    } else if (role === 'guest') {
      if (stored === undefined) return new Response('Room not found', { status: 404 });
      if (list.filter(m => m.a.role === 'guest').length >= MAX_GUESTS) return new Response('Room is full', { status: 409 });
      const n = ((await this.ctx.storage.get<number>('guests')) ?? 0) + 1;
      await this.ctx.storage.put('guests', n);
      attachment = { id: id(), role: 'guest', label: `Guest ${n}`, exploring: false };
    } else return new Response('Bad request', { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    asSocket(server).serializeAttachment(attachment);
    if (role === 'host') {
      await this.ctx.storage.deleteAlarm();
      for (const m of list) if (m.a.role === 'host') { try { asSocket(m.ws).close(4001, 'Replaced by a newer host connection'); } catch { } }
    }
    const state = await this.ctx.storage.get<RoomState>('state');
    const all = this.members();
    const host = all.find(m => m.a.role === 'host' && m.ws !== server);
    this.send(server, {
      t: 'welcome', you: { id: attachment.id, role: attachment.role }, ...(state ? { state } : {}), ...(role === 'guest' && host?.a.pose ? { hostPose: host.a.pose } : {}),
      hostPresent: all.some(m => m.a.role === 'host'), peers: peersOf(all.map(m => m.a)),
    });
    this.announce();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const a = attachmentOf(ws);
    if (!a) { asSocket(ws).close(1011, 'No session'); return; }
    const parsed = parseClientMessage(a.role, raw);
    if (!parsed.ok) { asSocket(ws).close(parsed.reason === 'too-large' ? 1009 : 1008, parsed.reason); return; }
    const taken = takeToken(this.buckets.get(a.id), Date.now(), a.role === 'host' ? HOST_RATE : GUEST_RATE);
    this.buckets.set(a.id, taken.bucket);
    if (!taken.allowed) return;
    const plan = relay(a, parsed.msg);
    if (plan.store?.state) await this.ctx.storage.put('state', plan.store.state);
    if (a.role === 'host' && parsed.msg.t === 'pose') asSocket(ws).serializeAttachment({ ...a, pose: parsed.msg.pose });
    if (a.role === 'guest' && parsed.msg.t === 'pose') asSocket(ws).serializeAttachment({ ...a, exploring: (parsed.msg as { exploring: boolean }).exploring });
    for (const m of this.members()) if (m.ws !== ws && m.a.role === (plan.to === 'host' ? 'host' : 'guest')) this.send(m.ws, plan.message);
  }

  async webSocketClose(ws: WebSocket, code?: number, reason?: string): Promise<void> {
    const a = attachmentOf(ws);
    try { asSocket(ws).close(code && code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, reason ?? ''); } catch { }
    if (!a) return;
    this.buckets.delete(a.id);
    const rest = this.members().filter(m => m.ws !== ws);
    for (const m of rest) this.send(m.ws, { t: 'peers', peers: peersOf(rest.map(r => r.a)) });
    if (a.role === 'host' && !rest.some(m => m.a.role === 'host')) {
      for (const m of rest) this.send(m.ws, { t: 'host-left' });
      await this.ctx.storage.setAlarm(Date.now() + HOST_GONE_MS);
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> { await this.webSocketClose(ws); }

  async alarm(): Promise<void> {
    if (this.members().some(m => m.a.role === 'host')) return;
    for (const m of this.members()) { try { asSocket(m.ws).close(1000, 'Room closed'); } catch { } }
    await this.ctx.storage.deleteAll();
  }
}
