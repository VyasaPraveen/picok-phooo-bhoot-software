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
    void loadCloudPacks().then(setPacks);
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

/** Returns a data: URL for an asset, cached for the session. */
export function assetDataUrl(boothId: string, assetId: string): Promise<string | null> {
  const key = `${boothId}/${assetId}`;
  let p = assetCache.get(key);
  if (!p) {
    p = get(ref(db, `booths/${boothId}/assets/${assetId}`))
      .then((s) => {
        const v = s.val() as { mime?: string; data?: string } | null;
        return v?.data ? `data:${v.mime ?? 'image/png'};base64,${v.data}` : null;
      })
      .catch(() => null);
    assetCache.set(key, p);
  }
  return p;
}

export function forgetAsset(boothId: string, assetId: string) {
  assetCache.delete(`${boothId}/${assetId}`);
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
    if (/^(https?:|data:|\/)/.test(src)) return src;
    return t.assetBase ? new URL(src, t.assetBase).href : null;
  });
}

export interface LogoImages {
  logo: HTMLImageElement | null;
  logoOnLight: HTMLImageElement | null;
}

/** The client logo if one is set, otherwise the Picok logo (with a badge version for light strips). */
export function useLogo(boothId: string | null, logoAssetId: string | null): LogoImages {
  const [imgs, setImgs] = useState<LogoImages>({ logo: null, logoOnLight: null });
  useEffect(() => {
    let alive = true;
    (async () => {
      if (boothId && logoAssetId) {
        const url = await assetDataUrl(boothId, logoAssetId);
        if (url) {
          const logo = await loadImage(url).catch(() => null);
          if (logo && alive) {
            setImgs({ logo, logoOnLight: null });
            return;
          }
        }
      }
      const [logo, badge] = await Promise.all([
        loadImage('/brand/picok_logo_transparent.png').catch(() => null),
        loadImage('/brand/picok_logo.png').catch(() => null),
      ]);
      if (alive) setImgs({ logo, logoOnLight: badge });
    })();
    return () => {
      alive = false;
    };
  }, [boothId, logoAssetId]);
  return imgs;
}
