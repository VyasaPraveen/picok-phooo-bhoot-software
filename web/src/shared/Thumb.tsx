import { createContext, useContext, useEffect, useState } from 'react';
import { renderTemplate, templateHeight, templateWidth } from '../render';
import { layerImagesFor, type LogoImages } from './booth';
import type { BoothSettings } from './model';
import type { SourcedTemplate } from './templates';

/** What every preview needs besides the template itself. */
export interface RenderEnv {
  boothId: string | null;
  settings: BoothSettings;
  logo: LogoImages;
}

export const RenderEnvContext = createContext<RenderEnv | null>(null);

export const envKey = (e: RenderEnv) => {
  const s = e.settings;
  return [s.eventName, s.eventDate, s.showEventOnPrint, s.logoAssetId, s.logoStripBg, s.bwWholePrint, !!e.logo.logo].join('|');
};

/** Builds the render request fields shared by previews and real prints. */
export function renderExtras(e: RenderEnv) {
  const s = e.settings;
  return {
    logo: e.logo.logo,
    logoOnLight: e.logo.logoOnLight,
    eventName: s.showEventOnPrint ? s.eventName : '',
    eventDate: s.showEventOnPrint ? s.eventDate : '',
    showEvent: s.showEventOnPrint,
    bwWholePrint: s.bwWholePrint,
    logoBgOverride: s.logoStripBg === 'template' ? null : s.logoStripBg,
  };
}

const cache = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();

/** Renders previews one at a time so the UI stays responsive on the tablet. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

export function clearThumbCache() {
  cache.clear();
}

export function TemplateThumb({
  template,
  bw = false,
  scale = 0.25,
  className,
  alt,
}: {
  template: SourcedTemplate;
  bw?: boolean;
  scale?: number;
  className?: string;
  alt?: string;
}) {
  const env = useContext(RenderEnvContext);
  const key = env ? `${template.id}|${bw}|${scale}|${envKey(env)}` : '';
  const [url, setUrl] = useState<string | null>(() => cache.get(key) ?? null);

  useEffect(() => {
    if (!env || !env.logo.logo) return;
    const hit = cache.get(key);
    if (hit) {
      setUrl(hit);
      return;
    }
    let alive = true;
    void enqueue(async () => {
      if (!alive) return;
      const layerImages = await layerImagesFor(env.boothId, template);
      const canvas = await renderTemplate({ template, bw, layerImages, ...renderExtras(env) }, scale);
      const data = canvas.toDataURL('image/jpeg', 0.88);
      cache.set(key, data);
      if (cache.size > 160) cache.delete(cache.keys().next().value!);
      if (alive) setUrl(data);
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key, env?.logo.logo]);

  const ratio = `${templateWidth(template)} / ${templateHeight(template)}`;
  return url ? (
    <img src={url} alt={alt ?? template.name} className={className} style={{ aspectRatio: ratio }} draggable={false} />
  ) : (
    <div className={`thumb-placeholder ${className ?? ''}`} style={{ aspectRatio: ratio }} aria-label={alt ?? template.name} />
  );
}
