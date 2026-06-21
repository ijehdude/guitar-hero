/**
 * The in-app LIBRARY: a curated catalog (metadata only) of iconic songs, plus
 * any extra files you've added. Audio is NEVER bundled — a song becomes playable
 * when its audio is present on THIS device, via either:
 *   • the local-dev `private_audio/` folder (served by the dev-only Vite plugin), or
 *   • the in-app Import flow (cached client-side in IndexedDB).
 *
 * Discovery is a purely local filter/search over the catalog — it never hits the
 * network. (Online "search any song" stays stubbed; see audio/source.ts + ROADMAP.)
 */
import catalog from "../data/catalog.json";
import type { Difficulty } from "../core/storage";
import { getAudio, cachedAudioKeys } from "./mediaCache";

export interface CatalogEntry {
  id: string;
  title: string;
  artist: string;
  group: string;
  difficultyHint: Difficulty;
}
export interface CatalogGroup {
  id: string;
  label: string;
}
export type AudioSourceKind = "dev" | "cache" | "remote" | "none";

export interface ResolvedEntry extends CatalogEntry {
  source: AudioSourceKind;
  file?: string; // filename when source === "dev" | "remote"
  base?: string; // host base URL when source === "remote"
  token?: string; // host token when source === "remote"
}

export interface LibraryHost {
  baseUrl: string;
  token: string;
}

const EXTRAS_GROUP: CatalogGroup = { id: "imports", label: "My Songs" };

// ---- text normalisation + fuzzy matching ----------------------------------
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
function tokenize(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter(Boolean));
}
function coverage(fileTokens: Set<string>, entryTokens: Set<string>): number {
  if (entryTokens.size === 0) return 0;
  let hit = 0;
  for (const t of entryTokens) if (fileTokens.has(t)) hit++;
  return hit / entryTokens.size;
}

function parseFilename(file: string): { artist: string; title: string } {
  const base = file.replace(/\.[^.]+$/, "");
  // common patterns: "Artist - Title", "Artist_ Title" (sanitised colon)
  const sep = base.match(/\s-\s|_\s/);
  if (sep && sep.index != null) {
    return { artist: base.slice(0, sep.index).trim(), title: base.slice(sep.index + sep[0].length).trim() };
  }
  return { artist: "", title: base.trim() };
}

export class Library {
  readonly groups: CatalogGroup[] = (catalog as any).groups;
  /** catalog entries + any discovered extras (files not in the catalog) */
  entries: CatalogEntry[] = [...((catalog as any).songs as CatalogEntry[])];

  private devFileById = new Map<string, string>(); // id -> filename on disk (dev)
  private cachedIds = new Set<string>(); // ids with audio cached in IndexedDB
  private remoteFileById = new Map<string, string>(); // id -> filename on the host
  private remote: { base: string; token: string } | null = null;
  isDev = false;
  remoteCount = 0;
  remoteReachable = false; // is the configured library host reachable right now?

  async init(host?: LibraryHost): Promise<void> {
    await Promise.all([this.loadDevManifest(), this.loadCached(), this.loadRemoteManifest(host)]);
  }

  /** Connect to a personal library host (your laptop) and mark its songs available. */
  async loadRemoteManifest(host?: LibraryHost): Promise<void> {
    this.remote = null;
    this.remoteFileById.clear();
    this.remoteCount = 0;
    this.remoteReachable = false;
    if (!host?.baseUrl || !host?.token) return;
    const base = host.baseUrl.replace(/\/+$/, "");
    try {
      const res = await fetch(`${base}/manifest?token=${encodeURIComponent(host.token)}`, { cache: "no-store" });
      if (!res.ok) return; // host offline / wrong token → songs just stay locked
      const files: string[] = (await res.json()).files ?? [];
      this.remote = { base, token: host.token };
      this.remoteReachable = true;
      const byFile = this.matchFilenames(files);
      for (const [file, id] of byFile) if (!this.remoteFileById.has(id)) this.remoteFileById.set(id, file);
      this.remoteCount = this.remoteFileById.size;
    } catch {
      /* unreachable host — leave remote unset */
    }
  }

  /** Cheap liveness check against the host's /health (updates remoteReachable). */
  async pingHost(host?: LibraryHost): Promise<boolean> {
    const h = host ?? (this.remote ? { baseUrl: this.remote.base, token: this.remote.token } : null);
    if (!h?.baseUrl || !h?.token) { this.remoteReachable = false; return false; }
    const base = h.baseUrl.replace(/\/+$/, "");
    try {
      const signal = (AbortSignal as any).timeout ? (AbortSignal as any).timeout(4000) : undefined;
      const res = await fetch(`${base}/health?token=${encodeURIComponent(h.token)}`, { cache: "no-store", signal });
      this.remoteReachable = res.ok;
      return res.ok;
    } catch {
      this.remoteReachable = false;
      return false;
    }
  }

  private async loadCached() {
    const keys = await cachedAudioKeys();
    this.cachedIds = new Set(keys);
  }

  private async loadDevManifest() {
    let files: string[] = [];
    try {
      const res = await fetch("/__private_audio_manifest", { cache: "no-store" });
      if (!res.ok) return; // production build — no dev folder
      files = (await res.json()).files ?? [];
      this.isDev = true;
    } catch {
      return;
    }
    const byFile = this.matchFilenames(files);
    for (const [file, id] of byFile) this.devFileById.set(id, file);
  }

  /**
   * Greedily match filenames to catalog entries ("Artist - Title" → entry).
   * Unmatched files are registered as extra "My Songs" entries. Returns a
   * file→entryId map. Used by both the dev folder scan and the Import flow.
   */
  matchFilenames(files: string[]): Map<string, string> {
    const out = new Map<string, string>();
    const usedIds = new Set<string>();
    type Pair = { file: string; id: string; cov: number };
    const pairs: Pair[] = [];
    const entryTokens = new Map<string, Set<string>>();
    for (const e of this.entries) entryTokens.set(e.id, tokenize(`${e.artist} ${e.title}`));

    for (const file of files) {
      const ft = tokenize(file.replace(/\.[^.]+$/, ""));
      for (const e of this.entries) {
        const cov = coverage(ft, entryTokens.get(e.id)!);
        if (cov >= 0.7) pairs.push({ file, id: e.id, cov });
      }
    }
    pairs.sort((a, b) => b.cov - a.cov);
    for (const p of pairs) {
      if (out.has(p.file) || usedIds.has(p.id)) continue;
      out.set(p.file, p.id);
      usedIds.add(p.id);
    }

    // Files that matched nothing → add as extra "My Songs" entries.
    for (const file of files) {
      if (out.has(file)) continue;
      const { artist, title } = parseFilename(file);
      const id = "imp:" + norm(file);
      if (!this.entries.some((e) => e.id === id)) {
        this.entries.push({ id, title: title || file, artist: artist || "Imported", group: EXTRAS_GROUP.id, difficultyHint: "medium" });
      }
      out.set(file, id);
    }
    return out;
  }

  allGroups(): CatalogGroup[] {
    const hasExtras = this.entries.some((e) => e.group === EXTRAS_GROUP.id);
    return hasExtras ? [...this.groups, EXTRAS_GROUP] : this.groups;
  }

  resolve(entry: CatalogEntry): ResolvedEntry {
    const dev = this.devFileById.get(entry.id);
    if (dev) return { ...entry, source: "dev", file: dev };
    if (this.cachedIds.has(entry.id)) return { ...entry, source: "cache" };
    const rf = this.remoteFileById.get(entry.id);
    if (rf && this.remote) return { ...entry, source: "remote", file: rf, base: this.remote.base, token: this.remote.token };
    return { ...entry, source: "none" };
  }

  isAvailable(id: string): boolean {
    return this.devFileById.has(id) || this.cachedIds.has(id) || this.remoteFileById.has(id);
  }

  hasAnyAudio(): boolean {
    return this.devFileById.size > 0 || this.cachedIds.size > 0 || this.remoteFileById.size > 0;
  }

  /** Local-only search/filter by artist (primary) or title. */
  search(query: string): CatalogEntry[] {
    const q = norm(query);
    if (!q) return this.entries;
    const qt = q.split(" ").filter(Boolean);
    return this.entries.filter((e) => {
      const hay = norm(`${e.artist} ${e.title}`);
      return qt.every((t) => hay.includes(t));
    });
  }

  /** Fetch the raw audio bytes for a resolved entry (dev disk or IndexedDB). */
  async getAudioData(entry: ResolvedEntry): Promise<ArrayBuffer | null> {
    if (entry.source === "dev" && entry.file) {
      const res = await fetch("/__private_audio/" + encodeURIComponent(entry.file), { cache: "force-cache" });
      if (!res.ok) return null;
      return await res.arrayBuffer();
    }
    if (entry.source === "cache") {
      const blob = await getAudio(entry.id);
      return blob ? await blob.arrayBuffer() : null;
    }
    if (entry.source === "remote" && entry.file && entry.base) {
      const res = await fetch(`${entry.base}/audio/${encodeURIComponent(entry.file)}?token=${encodeURIComponent(entry.token ?? "")}`, { cache: "force-cache" });
      if (!res.ok) return null;
      return await res.arrayBuffer();
    }
    return null;
  }

  /** Mark an entry's audio as cached (after a successful import). */
  markCached(id: string) {
    this.cachedIds.add(id);
  }
}

export const EXTRAS_GROUP_ID = EXTRAS_GROUP.id;
