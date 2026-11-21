import type { FurnishResult } from './model';

export type Vec3 = [number, number, number];
export interface Pose { p: Vec3; t: Vec3 }
export type Role = 'host' | 'guest';
export interface PeerInfo { id: string; role: Role; label: string }
export interface ShareState {
  mode: 'tower' | 'unit';
  floor: number | null;
  unitId: string | null;
  furnish: FurnishResult | null;
  key: string;
  reply?: string | null;
  whys?: string[];
}
export type ServerMessage =
  | { t: 'welcome'; you: { id: string; role: Role }; state?: ShareState; hostPose?: Pose; hostPresent: boolean; peers: PeerInfo[] }
  | { t: 'state'; state: ShareState }
  | { t: 'pose'; from: string; role: Role; pose: Pose; exploring?: boolean }
  | { t: 'peers'; peers: PeerInfo[] }
  | { t: 'host-left' };
export type ClientMessage =
  | { t: 'state'; state: ShareState }
  | { t: 'pose'; pose: Pose }
  | { t: 'pose'; pose: Pose; exploring: boolean };
export type RoomStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'failed';

export const CODE_RE = /^[a-z0-9]{10}$/;
export const SESSION_KEY = 'roomshift-tower-host';
export const POSE_INTERVAL_MS = 100;
const RETRY_MS = [500, 1000, 2000, 4000, 8000];

const random = (length: number, alphabet: string) => Array.from(crypto.getRandomValues(new Uint8Array(length)), b => alphabet[b % alphabet.length]).join('');
export const makeCode = () => random(10, '0123456789abcdefghijklmnopqrstuvwxyz');
export const makeSecret = () => random(32, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');

export function followCodeFromUrl(search: string): string | null {
  const value = new URLSearchParams(search).get('follow');
  return value !== null && CODE_RE.test(value) ? value : null;
}
export const hasFollowParam = (search: string) => new URLSearchParams(search).has('follow');
export const shareLink = (origin: string, code: string) => `${origin}/tower?follow=${code}`;

export function loadHostSession(): { code: string; secret: string } | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
    return raw && CODE_RE.test(raw.code) && typeof raw.secret === 'string' && raw.secret.length >= 16 ? { code: raw.code, secret: raw.secret } : null;
  } catch { return null; }
}
export const saveHostSession = (session: { code: string; secret: string } | null) => {
  try { if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); else sessionStorage.removeItem(SESSION_KEY); } catch { }
};

const isVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));
export const isPose = (v: unknown): v is Pose => !!v && typeof v === 'object' && isVec((v as Pose).p) && isVec((v as Pose).t);

function readMessage(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') return null;
  try {
    const m = JSON.parse(data);
    if (!m || typeof m !== 'object') return null;
    if (m.t === 'welcome' && m.you && Array.isArray(m.peers)) return m;
    if (m.t === 'state' && m.state && typeof m.state === 'object') return m;
    if (m.t === 'pose' && isPose(m.pose) && typeof m.from === 'string') return m;
    if (m.t === 'peers' && Array.isArray(m.peers)) return m;
    if (m.t === 'host-left') return m;
  } catch { }
  return null;
}

export interface RoomOptions {
  code: string;
  role: Role;
  secret?: string;
  onMessage(message: ServerMessage): void;
  onStatus(status: RoomStatus): void;
}
export interface RoomConnection { send(message: ClientMessage): boolean; close(): void }

export function connectRoom(options: RoomOptions): RoomConnection {
  let socket: WebSocket | null = null, stopped = false, attempts = 0, opened = false, timer: ReturnType<typeof setTimeout> | undefined;
  const query = options.role === 'host' ? `role=host&secret=${encodeURIComponent(options.secret ?? '')}` : 'role=guest';
  const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/tower-room/${options.code}?${query}`;

  const open = () => {
    options.onStatus(attempts === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => { opened = true; attempts = 0; options.onStatus('open'); };
    ws.onmessage = event => { const m = readMessage(event.data); if (m) options.onMessage(m); };
    ws.onclose = event => {
      if (socket !== ws) return;
      socket = null;
      if (stopped) return;
      const final = event.code === 1008 || event.code === 1009 || event.code === 4001;
      const limit = opened ? RETRY_MS.length : 2;
      if (final || attempts >= limit) { options.onStatus(final ? 'closed' : 'failed'); return; }
      timer = setTimeout(open, RETRY_MS[attempts++]);
      options.onStatus('reconnecting');
    };
  };
  open();
  return {
    send(message) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      const ws = socket;
      socket = null;
      try { ws?.close(1000, 'bye'); } catch { }
      options.onStatus('closed');
    },
  };
}

export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let last = 0, pending: A | null = null, timer: ReturnType<typeof setTimeout> | undefined;
  const run = (args: A) => { last = Date.now(); pending = null; fn(...args); };
  const call = (...args: A) => {
    const wait = last + ms - Date.now();
    if (wait <= 0) { clearTimeout(timer); timer = undefined; run(args); return; }
    pending = args;
    if (!timer) timer = setTimeout(() => { timer = undefined; if (pending) run(pending); }, wait);
  };
  call.cancel = () => { clearTimeout(timer); timer = undefined; pending = null; };
  return call;
}

const PEER_COLORS = ['#6fb5e8', '#e88f6f', '#a68be8', '#e8d26f', '#6fe8c0', '#e86fa8'];
export const HOST_COLOR = '#dabe89';
export function peerColor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PEER_COLORS[h % PEER_COLORS.length];
}
