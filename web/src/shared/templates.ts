import { builtinTemplates, isActiveOn, parseTemplate, type PrintSizeKey, type TemplateDef } from '../render';
import type { BoothSettings } from './model';

/** A template plus where its image layers resolve from. */
export interface SourcedTemplate extends TemplateDef {
  /** Base URL for relative image `src` values (remote packs). */
  assetBase?: string;
}

const categoryRank = (c: string) => (c === 'festival' || c === 'event' ? 0 : c === 'retro' ? 1 : c === 'custom' ? 2 : 3);

let packCache: Promise<SourcedTemplate[]> | null = null;

/** Festival/event packs published with the hosting deploy at /cloud (see template_cloud/README.md). */
export function loadCloudPacks(force = false): Promise<SourcedTemplate[]> {
  if (packCache && !force) return packCache;
  packCache = (async () => {
    try {
      const res = await fetch('/cloud/manifest.json', { cache: 'no-cache' });
      if (!res.ok) return [];
      const manifest = (await res.json()) as { packs?: { id?: string; url?: string }[] };
      const out: SourcedTemplate[] = [];
      for (const p of manifest.packs ?? []) {
        if (!p.id || !p.url || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(p.id)) continue;
        try {
          const packUrl = new URL(p.url, new URL('/cloud/', location.origin));
          const pack = (await (await fetch(packUrl, { cache: 'no-cache' })).json()) as {
            activeFrom?: string;
            activeTo?: string;
            templates?: unknown[];
          };
          for (const raw of pack.templates ?? []) {
            if (!raw || typeof raw !== 'object') continue;
            const withDates = { activeFrom: pack.activeFrom, activeTo: pack.activeTo, ...(raw as object) };
            const t = parseTemplate(withDates, p.id);
            if (t) out.push({ ...t, assetBase: new URL('.', packUrl).href });
          }
        } catch {
          // One broken pack never breaks the booth.
        }
      }
      return out;
    } catch {
      return [];
    }
  })();
  return packCache;
}

export function parseCustomTemplates(raw: unknown): SourcedTemplate[] {
  if (!raw || typeof raw !== 'object') return [];
  return Object.values(raw as Record<string, unknown>)
    .map((v) => parseTemplate(v, 'custom'))
    .filter((t): t is TemplateDef => t !== null);
}

let builtins: SourcedTemplate[] | null = null;
export const getBuiltins = () => (builtins ??= builtinTemplates());

export function allTemplates(packs: SourcedTemplate[], custom: SourcedTemplate[]): SourcedTemplate[] {
  return [...packs, ...getBuiltins(), ...custom];
}

/** Operator's order first, then festival → retro → custom → standard. */
export function orderTemplates(list: SourcedTemplate[], s: BoothSettings): SourcedTemplate[] {
  const pos = new Map(s.templateOrder.map((id, i) => [id, i]));
  const idx = new Map(list.map((t, i) => [t.id, i]));
  return [...list].sort((a, b) => {
    const oa = pos.get(a.id);
    const ob = pos.get(b.id);
    if (oa !== undefined && ob !== undefined) return oa - ob;
    if (oa !== undefined) return -1;
    if (ob !== undefined) return 1;
    const r = categoryRank(a.category) - categoryRank(b.category);
    return r !== 0 ? r : idx.get(a.id)! - idx.get(b.id)!;
  });
}

export function visibleFor(list: SourcedTemplate[], s: BoothSettings, size: PrintSizeKey, now = new Date()) {
  return orderTemplates(list, s).filter((t) => t.size === size && !s.hiddenTemplates.includes(t.id) && isActiveOn(t, now));
}
