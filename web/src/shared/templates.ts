import { builtinTemplates, isActiveOn, parseTemplate, type PrintSizeKey, type TemplateDef } from '../render';
import type { BoothSettings } from './model';

/** A template plus where its image layers resolve from. */
export interface SourcedTemplate extends TemplateDef {
  /** Base URL for relative image `src` values (remote packs). */
  assetBase?: string;
}

/** The six AI designs come first: 1 Retro, 2 Festival, 3–6 the client's designs; then standard layouts. */
const categoryRank = (c: string) => (c === 'retro' ? 0 : c === 'festival' || c === 'event' ? 1 : c === 'custom' ? 2 : 3);

/** Retro, festival/event and client designs make up the six AI designs. */
export const isAiDesign = (t: TemplateDef) => t.category !== 'standard';

/** Strips always use this retro design; other sizes use the admin's choice (`aiRetroId`). */
export const STRIP_RETRO_ID = 'retro_vintage_film';

/** Sizes a 4×6 portrait AI design is also offered in, scaled to fit. */
const FITTED_SIZES: PrintSizeKey[] = ['3.5x5', '5x7', '6x8'];

/** The design a fitted copy (`id@size`) was made from. */
export const baseId = (id: string) => id.split('@')[0];

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
            // Packs carry festival/event designs only and can never replace a built-in design.
            if (!t || builtinIds().has(t.id) || out.some((x) => x.id === t.id)) continue;
            out.push({ ...t, category: t.category === 'event' ? 'event' : 'festival', aiSlot: undefined, assetBase: new URL('.', packUrl).href });
          }
        } catch {
          // One broken pack never breaks the booth.
        }
      }
      return out;
    } catch {
      packCache = null; // Retried later (e.g. when the tablet comes back online).
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
let builtinIdSet: Set<string> | null = null;
const builtinIds = () => (builtinIdSet ??= new Set(getBuiltins().map((t) => t.id)));

export function allTemplates(packs: SourcedTemplate[], custom: SourcedTemplate[]): SourcedTemplate[] {
  const list = [...packs, ...getBuiltins(), ...custom];
  const fitted: SourcedTemplate[] = [];
  for (const t of list) {
    if (t.size !== '4x6' || t.landscape || !isAiDesign(t)) continue;
    for (const size of FITTED_SIZES) fitted.push({ ...t, id: `${t.id}@${size}`, size, fitFrom: '4x6' });
  }
  return [...list, ...fitted];
}

/**
 * The six AI designs always come before the standard layouts (retro → festival → client designs);
 * within each group the operator's order applies, then the client slot number.
 */
export function orderTemplates(list: SourcedTemplate[], s: BoothSettings): SourcedTemplate[] {
  const pos = new Map(s.templateOrder.map((id, i) => [id, i]));
  const idx = new Map(list.map((t, i) => [t.id, i]));
  return [...list].sort((a, b) => {
    const r = categoryRank(a.category) - categoryRank(b.category);
    if (r !== 0) return r;
    const oa = pos.get(a.id);
    const ob = pos.get(b.id);
    if (oa !== undefined && ob !== undefined && oa !== ob) return oa - ob;
    if (oa !== undefined && ob === undefined) return -1;
    if (ob !== undefined && oa === undefined) return 1;
    const slot = (a.aiSlot ?? 9) - (b.aiSlot ?? 9);
    return slot !== 0 ? slot : idx.get(a.id)! - idx.get(b.id)!;
  });
}

/** The booth's retro design: the admin's choice, or the first one if that design no longer exists. */
export function activeRetroId(list: SourcedTemplate[], s: BoothSettings): string {
  const choices = retroChoices(list);
  return choices.some((t) => t.id === s.aiRetroId) ? s.aiRetroId : choices[0]?.id ?? s.aiRetroId;
}

/** A template switched off by the admin (a scaled copy follows its 4×6 design). */
export const isHidden = (t: SourcedTemplate, s: BoothSettings) => s.hiddenTemplates.includes(t.id) || s.hiddenTemplates.includes(baseId(t.id));

/**
 * What customers can pick for a size: the six AI designs (one retro, one festival live today, the
 * client's designs) and the standard layouts in the style of the event theme.
 * `includeHidden` also lists designs the admin switched off (for the dashboard).
 */
export function visibleFor(list: SourcedTemplate[], s: BoothSettings, size: PrintSizeKey, now = new Date(), includeHidden = false) {
  const retroId = size === '2x6' ? STRIP_RETRO_ID : activeRetroId(list, s);
  const standardStyle = s.theme === 'light' ? 'std_classic_' : 'std_midnight_';
  let festivalShown = false;
  return orderTemplates(list, s).filter((t) => {
    if (t.size !== size || !isActiveOn(t, now) || t.retired) return false;
    if (!includeHidden && isHidden(t, s)) return false;
    switch (t.category) {
      case 'standard':
        return t.id.startsWith(standardStyle);
      case 'retro':
        return baseId(t.id) === retroId;
      case 'festival':
      case 'event':
        // Customers get the first festival design that is switched on; the dashboard lists all of them.
        if (includeHidden) return true;
        if (festivalShown) return false;
        festivalShown = true;
        return true;
      default:
        return true;
    }
  });
}

/** Retro designs the admin can choose as the booth's one retro design (4×6 portrait). */
export const retroChoices = (list: SourcedTemplate[]) => list.filter((t) => t.category === 'retro' && t.size === '4x6' && !t.fitFrom);
