import { get, onValue, ref } from 'firebase/database';
import { useEffect, useMemo, useState } from 'react';
import { loadLayerImages, type TemplateDef } from '../render';
import { db } from './firebase';
import {
  normaliseSettings,
  type BoothSettings,
  type BoothState,
  type BridgeStatus,
} from './model';
import { allTemplates, loadCloudPacks, parseCustomTemplates, type SourcedTemplate } from './templates';

export interface BoothPins {
  adminHash?: string;
  operatorHash?: string;
}

export interface BoothData {
  settings: BoothSettings;
  state: BoothState | null;
  pins: BoothPins;
  bridge: BridgeStatus | null;
  templates: SourcedTemplate[];
  loaded: boolean;
}

/** Live view of one booth: settings, paper state, PINs, bridge status and all templates. */
export function useBoothData(boothId: string | null): BoothData {
  const [settings, setSettings] = useState<BoothSettings>(() => normaliseSettings(null));
  const [state, setState] = useState<BoothState | null>(null);
  const [pins, setPins] = useState<BoothPins>({});
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [custom, setCustom] = useState<SourcedTemplate[]>([]);
  const [packs, setPacks] = useState<SourcedTemplate[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = () => void loadCloudPacks().then(setPacks);
    load();
    // A tablet that started offline gets the festival packs once it is back online.
    addEventListener('online', load);
    return () => removeEventListener('online', load);
  }, []);

  useEffect(() => {
    if (!boothId) return;
    const base = `booths/${boothId}`;
    const unsubs = [
      onValue(ref(db, `${base}/settings`), (s) => {
        setSettings(normaliseSettings(s.val()));
        setLoaded(true);
      }),
      onValue(ref(db, `${base}/state`), (s) => setState((s.val() as BoothState | null) ?? null)),
      onValue(ref(db, `${base}/pins`), (s) => setPins((s.val() as BoothPins | null) ?? {})),
      onValue(ref(db, `${base}/bridge`), (s) => setBridge((s.val() as BridgeStatus | null) ?? null)),
      onValue(ref(db, `${base}/customTemplates`), (s) => setCustom(parseCustomTemplates(s.val()))),
    ];
    return () => unsubs.forEach((u) => u());
  }, [boothId]);

  const templates = useMemo(() => allTemplates(packs, custom), [packs, custom]);
  return { settings, state, pins, bridge, templates, loaded };
}

// ---- image assets (client logo, custom PNG frames) stored as base64 in the database ----

const assetCache = new Map<string, Promise<string | null>>();

/**
 * Assets never change once uploaded (every upload gets a new id), so they are also kept in the
 * browser's Cache Storage: a reload or an app update does not download frames and logos again,
 * which keeps the Firebase download quota for real traffic.
 */
const ASSET_STORE = 'picok-assets-v1';
const storeUrl = (key: string) => `/__asset/${key}`;

async function storedAsset(key: string): Promise<string | null> {
  try {
    const hit = await (await caches.open(ASSET_STORE)).match(storeUrl(key));
    return hit ? await hit.text() : null;
  } catch {
    return null;
  }
}

async function storeAsset(key: string, dataUrl: string) {
  try {
    await (await caches.open(ASSET_STORE)).put(storeUrl(key), new Response(dataUrl));
  } catch {
    // Storage full or blocked: the asset is downloaded again next time.
  }
}

/** Returns a data: URL for an asset (memory → device cache → database). */
export function assetDataUrl(boothId: string, assetId: string): Promise<string | null> {
  const key = `${boothId}/${assetId}`;
  let p = assetCache.get(key);
  if (!p) {
    p = (async () => {
      const stored = await storedAsset(key);
      if (stored) return stored;
      const v = (await get(ref(db, `booths/${boothId}/assets/${assetId}`))).val() as { mime?: string; data?: string } | null;
      if (!v?.data) return null;
      const url = `data:${v.mime ?? 'image/png'};base64,${v.data}`;
      void storeAsset(key, url);
      return url;
    })().catch(() => null);
    // A failed download is retried next time instead of being remembered as missing.
    void p.then((url) => {
      if (url === null) assetCache.delete(key);
    });
    assetCache.set(key, p);
  }
  return p;
}

export function forgetAsset(boothId: string, assetId: string) {
  const key = `${boothId}/${assetId}`;
  assetCache.delete(key);
  void caches.open(ASSET_STORE).then((c) => c.delete(storeUrl(key))).catch(() => undefined);
}

/** Drops cached assets the booth no longer uses (old logos, replaced frames, removed samples). */
export async function pruneAssetCache(boothId: string, keep: Set<string>) {
  try {
    const c = await caches.open(ASSET_STORE);
    const prefix = storeUrl(`${boothId}/`);
    for (const req of await c.keys()) {
      const path = new URL(req.url).pathname;
      if (path.startsWith(prefix) && !keep.has(decodeURIComponent(path.slice(prefix.length)))) await c.delete(req);
    }
  } catch {
    // Nothing to prune.
  }
}

/** Every asset id the booth's settings and custom designs refer to. */
export function referencedAssets(settings: BoothSettings, templates: SourcedTemplate[]): Set<string> {
  const ids = new Set<string>();
  for (const id of [settings.logoAssetId, settings.logoLightAssetId, ...settings.samplePhotoAssetIds]) if (id) ids.add(id);
  for (const t of templates) {
    for (const l of t.layers ?? []) if (typeof l.src === 'string' && l.src.startsWith('asset:')) ids.add(l.src.slice(6));
  }
  return ids;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = src;
  });
}

/** Image layers of a template: "asset:{id}" → booth asset, relative path → pack folder. */
export function layerImagesFor(boothId: string | null, t: SourcedTemplate) {
  return loadLayerImages(t as TemplateDef, async (src) => {
    if (src.startsWith('asset:')) return boothId ? assetDataUrl(boothId, src.slice(6)) : null;
    // Packs may only use images from their own folder on this site.
    if (t.assetBase) return /^([a-z]+:|\/)/i.test(src) ? null : new URL(src, t.assetBase).href;
    return /^(https?:|data:|\/)/.test(src) ? src : null;
  });
}

export interface LogoImages {
  logo: HTMLImageElement | null;
  logoOnLight: HTMLImageElement | null;
}

/** Picok logo files: white text for dark backgrounds, dark text for light backgrounds. */
export const PICOK_LOGO = { dark: '/brand/picok_logo_transparent.png', light: '/brand/picok_logo_light.png' };

/** The Picok logo that suits the booth's current screen theme (set on <html data-theme>). */
export const screenLogo = () => (document.documentElement.dataset.theme === 'light' ? PICOK_LOGO.light : PICOK_LOGO.dark);

const assetImage = async (boothId: string | null, id: string | null) => {
  if (!boothId || !id) return null;
  const url = await assetDataUrl(boothId, id);
  return url ? loadImage(url).catch(() => null) : null;
};

/**
 * The client logo if one is set (plus its optional light-background version), otherwise the
 * Picok logo in both versions. Light print backgrounds use `logoOnLight`.
 */
export function useLogo(boothId: string | null, logoAssetId: string | null, logoLightAssetId: string | null = null): LogoImages {
  const [imgs, setImgs] = useState<LogoImages>({ logo: null, logoOnLight: null });
  useEffect(() => {
    let alive = true;
    (async () => {
      const client = await assetImage(boothId, logoAssetId);
      if (client) {
        const light = await assetImage(boothId, logoLightAssetId);
        if (alive) setImgs({ logo: client, logoOnLight: light });
        return;
      }
      const [logo, light] = await Promise.all([
        loadImage(PICOK_LOGO.dark).catch(() => null),
        loadImage(PICOK_LOGO.light).catch(() => null),
      ]);
      if (alive) setImgs({ logo, logoOnLight: light });
    })();
    return () => {
      alive = false;
    };
  }, [boothId, logoAssetId, logoLightAssetId]);
  return imgs;
}

/** Sample photos the admin uploaded for design previews (empty = silhouettes). */
export function useSamplePhotos(boothId: string | null, ids: string[]): HTMLImageElement[] {
  const [imgs, setImgs] = useState<HTMLImageElement[]>([]);
  const key = ids.join(',');
  useEffect(() => {
    let alive = true;
    void Promise.all(ids.map((id) => assetImage(boothId, id))).then((list) => {
      if (alive) setImgs(list.filter((i): i is HTMLImageElement => i !== null));
    });
    return () => {
      alive = false;
    };
  }, [boothId, key]);
  return imgs;
}
