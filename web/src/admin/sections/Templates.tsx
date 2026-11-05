import { equalTo, get, orderByChild, query, ref, update } from 'firebase/database';
import { useEffect, useState } from 'react';
import { isActiveOn, PRINT_SIZES, SIZE_ORDER, templateHeight, templateWidth, type PrintSizeKey, type TemplateDef } from '../../render';
import { assetDataUrl, forgetAsset } from '../../shared/booth';
import { db } from '../../shared/firebase';
import { isPaidStatus, type Order } from '../../shared/model';
import { activeRetroId, isHidden, orderTemplates, retroChoices, STRIP_RETRO_ID, visibleFor, type SourcedTemplate } from '../../shared/templates';
import { clearThumbCache, TemplateThumb } from '../../shared/Thumb';
import { Toggle, useToast } from '../../shared/ui';
import { imageFileToJpeg, imageFileToPng, imageType, Panel, saveSettings, type SectionProps } from '../fields';

/** Client design slots 3–6 of the six AI designs (stored as `aiSlot` 1–4). */
const CLIENT_SLOTS = [1, 2, 3, 4] as const;

const customDesigns = (templates: SourcedTemplate[]) => templates.filter((t) => t.category === 'custom' && !t.fitFrom && !t.retired);

/** Client designs by slot; older frames without a slot fill the free slots in upload order. */
function clientSlots(templates: SourcedTemplate[]): Map<number, SourcedTemplate> {
  const customs = customDesigns(templates);
  const out = new Map<number, SourcedTemplate>();
  for (const t of customs) if (t.aiSlot && !out.has(t.aiSlot)) out.set(t.aiSlot, t);
  for (const t of customs) {
    if ([...out.values()].includes(t)) continue;
    const free = CLIENT_SLOTS.find((n) => !out.has(n));
    if (free) out.set(free, t);
  }
  return out;
}

const assetOf = (t: SourcedTemplate) => {
  const src = t.layers?.find((l) => l.type === 'image')?.src;
  return typeof src === 'string' && src.startsWith('asset:') ? src.slice(6) : null;
};

/** Paid orders not printed yet that use a design (or one of its scaled copies). */
async function openOrdersUsing(boothId: string, t: SourcedTemplate): Promise<string[]> {
  const ids = [t.id, ...(['3.5x5', '5x7', '6x8'] as const).map((s) => `${t.id}@${s}`)];
  const found: string[] = [];
  for (const id of ids) {
    const snap = await get(query(ref(db, `booths/${boothId}/orders`), orderByChild('templateId'), equalTo(id)));
    snap.forEach((c) => {
      const o = c.val() as Order;
      if (isPaidStatus(o.status) && o.status !== 'printed' && !o.refundedAt) found.push(o.id);
    });
  }
  return found;
}

/**
 * Database changes that take a design away: deleted with its image, or kept as `retired` (hidden
 * from customers) while paid orders still need it for printing.
 */
function removalPatch(t: SourcedTemplate, keep: boolean): Record<string, unknown> {
  if (keep) return { [`customTemplates/${t.id}/retired`]: true };
  const asset = assetOf(t);
  return { [`customTemplates/${t.id}`]: null, ...(asset ? { [`assets/${asset}`]: null } : {}) };
}

export function TemplatesSection({ boothId, data }: SectionProps) {
  const toast = useToast();
  const s = data.settings;
  const [size, setSize] = useState<PrintSizeKey>('4x6');
  const [adding, setAdding] = useState<{ slot: number; replacing: SourcedTemplate | null } | null>(null);
  const ordered = orderTemplates(data.templates, s);
  // What customers can pick for this size (switched-off designs included, so they can be switched on).
  const list = visibleFor(data.templates, s, size, new Date(), true);

  const move = (id: string, dir: -1 | 1) => {
    const subset = list.map((t) => t.id);
    const i = subset.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= subset.length) return;
    [subset[i], subset[j]] = [subset[j], subset[i]];
    const rest = ordered.map((t) => t.id).filter((x) => !subset.includes(x));
    void saveSettings(boothId, { templateOrder: [...subset, ...rest] });
  };

  const toggle = (t: SourcedTemplate, visible: boolean) => {
    const hidden = new Set(s.hiddenTemplates);
    if (visible) {
      hidden.delete(t.id);
      // Switching on a scaled copy also switches on its 4×6 design, which hides all its copies.
      hidden.delete(t.id.split('@')[0]);
    } else hidden.add(t.id);
    void saveSettings(boothId, { hiddenTemplates: [...hidden] });
  };

  const removeDesign = async (t: SourcedTemplate) => {
    if (!confirm(`Delete the design “${t.name}”?`)) return;
    try {
      const open = await openOrdersUsing(boothId, t);
      await update(ref(db, `booths/${boothId}`), removalPatch(t, open.length > 0));
      const asset = assetOf(t);
      if (asset && open.length === 0) forgetAsset(boothId, asset);
      clearThumbCache();
      toast(
        open.length > 0
          ? `Removed for customers. Kept until ${open.length} paid order${open.length === 1 ? ' is' : 's are'} printed (${open.slice(0, 3).join(', ')}).`
          : 'Design deleted.',
      );
    } catch {
      toast('Could not delete the design. Check your connection.', true);
    }
  };

  const packs = data.templates.filter((t) => t.packId && t.packId !== 'builtin' && t.packId !== 'custom' && !t.fitFrom);
  const slotted = new Set(clientSlots(data.templates).values());
  const extras = data.templates.filter((t) => t.category === 'custom' && !t.fitFrom && (t.retired || !slotted.has(t)));

  return (
    <>
      <AiDesignsPanel boothId={boothId} data={data} onUpload={(slot, replacing) => setAdding({ slot, replacing })} onDelete={(t) => void removeDesign(t)} />
      <SamplePhotosPanel boothId={boothId} data={data} />
      <Panel
        title="What customers see"
        subtitle={`The AI designs for each size, then the standard layouts in the ${s.theme === 'light' ? 'Classic White (light theme)' : 'Picok Midnight (dark theme)'} style. Switch off designs that do not suit the event and arrange the order.`}
      >
        <div className="chip-row">
          {SIZE_ORDER.map((k) => (
            <button key={k} className="chip" aria-pressed={size === k} onClick={() => setSize(k)}>{PRINT_SIZES[k].shortLabel}</button>
          ))}
        </div>
        <div className="template-admin-list">
          {list.length === 0 && <p className="dim">No designs for this size.</p>}
          {list.map((t, i) => {
            const dates = [t.activeFrom && `from ${t.activeFrom}`, t.activeTo && `until ${t.activeTo}`].filter(Boolean).join(' ');
            return (
              <div key={t.id} className="template-admin-row">
                <div className="reorder">
                  <button aria-label={`Move ${t.name} up`} disabled={i === 0} onClick={() => move(t.id, -1)}>▲</button>
                  <button aria-label={`Move ${t.name} down`} disabled={i === list.length - 1} onClick={() => move(t.id, 1)}>▼</button>
                </div>
                <div className="mini-thumb"><TemplateThumb template={t} scale={0.08} /></div>
                <div className="grow">
                  <strong>{t.name}</strong>
                  <div className="dim small">
                    {t.category === 'standard' ? 'STANDARD' : 'AI DESIGN'} · {t.slots.length} photo{t.slots.length === 1 ? '' : 's'}
                    {t.landscape ? ' · landscape' : ''}
                    {t.fitFrom ? ` · 4×6 design scaled to ${PRINT_SIZES[t.size].shortLabel}` : ''}
                    {dates ? ` · ${dates}` : ''}
                  </div>
                </div>
                <Toggle label={`Show ${t.name}`} checked={!isHidden(t, s)} onChange={(v) => toggle(t, v)} />
              </div>
            );
          })}
        </div>
      </Panel>
      {extras.length > 0 && (
        <Panel
          title="Other uploaded designs"
          subtitle="Designs outside the four client slots, or retired ones kept for paid orders that still need printing. Customers do not see retired designs."
        >
          <div className="template-admin-list">
            {extras.map((t) => (
              <div key={t.id} className="template-admin-row">
                <div className="mini-thumb"><TemplateThumb template={t} scale={0.08} /></div>
                <div className="grow">
                  <strong>{t.name}</strong>
                  <div className="dim small">{PRINT_SIZES[t.size].shortLabel} · {t.retired ? 'retired' : 'shown to customers'}</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => void removeDesign(t)}>Delete</button>
              </div>
            ))}
          </div>
        </Panel>
      )}
      <Panel
        title="EPIXS template cloud"
        subtitle="Festival and event packs are published with the website (web/public/cloud) and switch on and off by date automatically. Switch one off here before its dates if it does not suit the event."
      >
        {packs.length === 0 ? (
          <p className="dim">No packs published.</p>
        ) : (
          <div className="template-admin-list">
            {packs.map((t) => (
              <div key={t.id} className="template-admin-row">
                <div className="grow">
                  <strong>{t.name}</strong>{' '}
                  <span className="dim small">· {PRINT_SIZES[t.size].shortLabel} · {t.activeFrom ?? 'always'} → {t.activeTo ?? '…'}{isActiveOn(t, new Date()) ? ' · LIVE' : ''}</span>
                </div>
                <Toggle label={`Show ${t.name}`} checked={!isHidden(t, s)} onChange={(v) => toggle(t, v)} />
              </div>
            ))}
          </div>
        )}
      </Panel>
      {adding && (
        <AddFrameDialog
          boothId={boothId}
          data={data}
          slot={adding.slot}
          replacing={adding.replacing}
          onClose={() => setAdding(null)}
        />
      )}
    </>
  );
}

/** The six AI designs: 1 Retro (chosen here), 2 Festival (by date), 3–6 the client's designs. */
function AiDesignsPanel({
  boothId,
  data,
  onUpload,
  onDelete,
}: SectionProps & { onUpload: (slot: number, replacing: SourcedTemplate | null) => void; onDelete: (t: SourcedTemplate) => void }) {
  const s = data.settings;
  const retros = retroChoices(data.templates);
  const retroId = activeRetroId(data.templates, s);
  const retro = retros.find((t) => t.id === retroId);
  const strip = data.templates.find((t) => t.id === STRIP_RETRO_ID);
  const today = new Date();
  const festivals = orderTemplates(data.templates, s).filter((t) => (t.category === 'festival' || t.category === 'event') && !t.fitFrom);
  // The one customers see: the first live festival design that is switched on.
  const liveFestival = festivals.find((t) => isActiveOn(t, today) && !isHidden(t, s));
  const nextFestival = festivals
    .filter((t) => t.activeFrom && t.activeFrom > today.toLocaleDateString('en-CA') && !isHidden(t, s))
    .sort((a, b) => a.activeFrom!.localeCompare(b.activeFrom!))[0];
  const slots = clientSlots(data.templates);

  return (
    <Panel title="Six AI designs" subtitle="Customers see these six designs first, then the standard layouts.">
      <div className="ai-grid">
        <div className="ai-card">
          <span className="ai-num">1</span>
          <strong>Retro</strong>
          <div className="ai-thumbs">
            {retro && <TemplateThumb template={retro} scale={0.1} />}
            {strip && <TemplateThumb template={strip} scale={0.1} />}
          </div>
          <select aria-label="Retro design" value={retroId} onChange={(e) => void saveSettings(boothId, { aiRetroId: e.target.value })}>
            {retros.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <span className="dim small">2×6 strips always use Vintage Film Strip.</span>
          {retro && isHidden(retro, s) && <span className="error-text small">This design is switched off below, so customers see no retro design.</span>}
        </div>
        <div className="ai-card">
          <span className="ai-num">2</span>
          <strong>Festival</strong>
          <div className="ai-thumbs">{liveFestival && <TemplateThumb template={liveFestival} scale={0.1} />}</div>
          <span className="dim small">
            {liveFestival
              ? `${liveFestival.name} is live until ${liveFestival.activeTo ?? 'further notice'}.`
              : nextFestival
                ? `None live today. Next: ${nextFestival.name} from ${nextFestival.activeFrom}.`
                : 'No festival design scheduled.'}
            {' '}Switches by date automatically.
          </span>
        </div>
        {CLIENT_SLOTS.map((n) => {
          const t = slots.get(n);
          return (
            <div key={n} className={`ai-card ${t ? '' : 'empty'}`}>
              <span className="ai-num">{n + 2}</span>
              <strong>{t ? t.name : `Client design ${n}`}</strong>
              <div className="ai-thumbs">{t && <TemplateThumb template={t} scale={0.1} />}</div>
              {t ? (
                <>
                  <span className="dim small">{PRINT_SIZES[t.size].shortLabel} · {t.slots.length} photo{t.slots.length === 1 ? '' : 's'}</span>
                  <div className="row-gap">
                    <button className="btn btn-soft btn-sm" onClick={() => onUpload(n, t)}>Replace</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => onDelete(t)}>Delete</button>
                  </div>
                </>
              ) : (
                <>
                  <span className="dim small">Hidden from customers until a design is uploaded.</span>
                  <button className="btn btn-primary btn-sm" onClick={() => onUpload(n, null)}>⬆ Upload design</button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** Sample photos used in every design preview instead of silhouettes (never on real prints). */
function SamplePhotosPanel({ boothId, data }: SectionProps) {
  const toast = useToast();
  const ids = data.settings.samplePhotoAssetIds;
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all(ids.map(async (id) => [id, await assetDataUrl(boothId, id)] as const)).then((r) =>
      setUrls(Object.fromEntries(r.filter((x): x is readonly [string, string] => !!x[1]))),
    );
  }, [boothId, ids.join(',')]);

  const add = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const jpg = await imageFileToJpeg(file, 1400);
      const id = `sample-${Date.now()}`;
      // The photo and its reference are saved together, so a failed save leaves nothing behind.
      await update(ref(db, `booths/${boothId}`), {
        [`assets/${id}`]: { name: file.name.slice(0, 120), mime: 'image/jpeg', data: jpg.data, width: jpg.width, height: jpg.height, updatedAt: Date.now() },
        'settings/samplePhotoAssetIds': [...ids, id].slice(-4),
        ...(ids.length >= 4 ? { [`assets/${ids[0]}`]: null } : {}),
      });
      clearThumbCache();
      toast('Sample photo added. Design previews now use it.');
    } catch (e) {
      toast((e as Error).message || 'Upload failed.', true);
    } finally {
      setBusy(false);
    }
  };

  const drop = async (id: string) => {
    try {
      await update(ref(db, `booths/${boothId}`), {
        'settings/samplePhotoAssetIds': ids.filter((x) => x !== id),
        [`assets/${id}`]: null,
      });
      forgetAsset(boothId, id);
      clearThumbCache();
    } catch {
      toast('Could not remove the photo. Check your connection.', true);
    }
  };

  return (
    <Panel
      title="Sample photos for previews"
      subtitle="Shown in the design previews customers choose from (for example the Film strip) instead of silhouettes. Up to 4 photos; they are never printed."
    >
      <div className="sample-row">
        {ids.map((id, i) => (
          <div key={id} className="sample-photo">
            {urls[id] ? <img src={urls[id]} alt={`Sample photo ${i + 1}`} /> : <div className="thumb-placeholder" />}
            <button className="btn btn-ghost btn-sm" aria-label={`Remove sample photo ${i + 1}`} onClick={() => void drop(id)}>Remove</button>
          </div>
        ))}
        {ids.length < 4 && (
          <label className={`btn btn-primary btn-sm ${busy ? 'disabled' : ''}`}>
            {busy ? 'Uploading…' : '⬆ Add sample photo'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="visually-hidden"
              disabled={busy}
              onChange={(e) => {
                void add(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        )}
      </div>
    </Panel>
  );
}

function AddFrameDialog({
  boothId,
  data,
  slot,
  replacing,
  onClose,
}: SectionProps & {
  slot: number;
  replacing: SourcedTemplate | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const templates = data.templates;
  const [size, setSize] = useState<PrintSizeKey>(replacing?.size ?? '4x6');
  const bases = templates.filter((t) => t.size === size && t.id.startsWith('std_classic_'));
  const [baseId, setBaseId] = useState('');
  const [name, setName] = useState(replacing?.name ?? `Client design ${slot}`);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const base = bases.find((b) => b.id === baseId) ?? bases[0];

  const save = async () => {
    if (!base || !file) return;
    setBusy(true);
    try {
      const w = templateWidth(base);
      const h = templateHeight(base);
      if (imageType(file) !== 'image/png') throw new Error('The design must be a PNG with transparent windows for the photos.');
      const bmp = await createImageBitmap(file);
      const [bw, bh] = [bmp.width, bmp.height];
      bmp.close();
      if (Math.abs(bw / bh / (w / h) - 1) > 0.02) {
        throw new Error(`The design must be ${w} × ${h} px (or the same shape); this one would be stretched.`);
      }
      if (bw < w * 0.9) throw new Error(`The design is only ${bw} × ${bh} px and would print blurry. Export it at ${w} × ${h} px.`);
      const img = await imageFileToPng(file, Math.max(w, h), { webp: true });
      const id = `custom_${Date.now()}`;
      const assetId = `frame-${Date.now()}`;
      const t: TemplateDef = {
        id,
        name: name.trim().slice(0, 60) || `Client design ${slot}`,
        category: 'custom',
        description: `AI design ${slot + 2} · ${base.slots.length} photo${base.slots.length === 1 ? '' : 's'}`,
        size: base.size,
        landscape: !!base.landscape,
        filter: 'none',
        background: { color: '#FFFFFF' },
        layers: [{ type: 'image', src: `asset:${assetId}`, x: 0, y: 0, w, h, fit: 'fill', z: 'above' }],
        slots: base.slots,
        logo: base.logo,
        aiSlot: slot,
      };
      const patch: Record<string, unknown> = {
        [`assets/${assetId}`]: { name: file.name.slice(0, 120), mime: img.mime, data: img.data, width: img.width, height: img.height, updatedAt: Date.now() },
        [`customTemplates/${id}`]: JSON.parse(JSON.stringify(t)),
      };
      let kept = 0;
      if (replacing) {
        // The old design is retired (kept for paid orders still to print) or deleted with its image,
        // and its on/off switch and position carry over to the new design.
        kept = (await openOrdersUsing(boothId, replacing)).length;
        Object.assign(patch, removalPatch(replacing, kept > 0));
        const swap = (list: string[]) => list.map((x) => (x === replacing.id ? id : x.startsWith(`${replacing.id}@`) ? `${id}${x.slice(replacing.id.length)}` : x));
        const s = data.settings;
        if (s.hiddenTemplates.some((x) => x === replacing.id || x.startsWith(`${replacing.id}@`))) patch['settings/hiddenTemplates'] = swap(s.hiddenTemplates);
        if (s.templateOrder.some((x) => x === replacing.id || x.startsWith(`${replacing.id}@`))) patch['settings/templateOrder'] = swap(s.templateOrder);
      }
      // One update: the design, its image and the clean-up are saved together or not at all.
      await update(ref(db, `booths/${boothId}`), patch);
      const old = replacing && kept === 0 ? assetOf(replacing) : null;
      if (old) forgetAsset(boothId, old);
      clearThumbCache();
      toast(replacing ? (kept ? `Design replaced. The old one is kept until ${kept} paid order${kept === 1 ? ' is' : 's are'} printed.` : 'Design replaced.') : 'Design added. Customers can choose it now.');
      onClose();
    } catch (e) {
      toast((e as Error).message || 'Could not add the design.', true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`AI design ${slot + 2}`} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="dialog card" onClick={(e) => e.stopPropagation()}>
        <h2>{replacing ? 'Replace' : 'Upload'} AI design {slot + 2}</h2>
        <label>Print size
          <select autoFocus value={size} onChange={(e) => { setSize(e.target.value as PrintSizeKey); setBaseId(''); }}>
            {SIZE_ORDER.map((k) => (
              <option key={k} value={k}>{PRINT_SIZES[k].label}</option>
            ))}
          </select>
        </label>
        <label>Photo layout the design was made for
          <select value={base?.id ?? ''} onChange={(e) => setBaseId(e.target.value)}>
            {bases.map((b) => (
              <option key={b.id} value={b.id}>{b.slots.length} photo{b.slots.length === 1 ? '' : 's'}{b.landscape ? ' · landscape' : ''}</option>
            ))}
          </select>
        </label>
        {base && (
          <p className="dim small">
            Design a PNG of <b>{templateWidth(base)} × {templateHeight(base)} px</b> (300 dpi) in Canva or Photoshop, with transparent windows where the photos go:
            <br />
            {base.slots.map((sl, i) => (
              <span key={i}>• x {Math.round(sl.x)}, y {Math.round(sl.y)}, {Math.round(sl.w)} × {Math.round(sl.h)}<br /></span>
            ))}
            Leave the bottom strip (from y {Math.round(base.logo.y)}) transparent to keep the client logo.
            {size === '4x6' && !base.landscape ? ' A 4×6 design is also offered at 3.5×5, 5×7 and 6×8, scaled to fit.' : ''}
          </p>
        )}
        <label>Design name<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>PNG design<input type="file" accept="image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <div className="row-gap end">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={!file || !base || busy} onClick={() => void save()}>{busy ? 'Saving…' : replacing ? 'Replace design' : 'Add design'}</button>
        </div>
      </div>
    </div>
  );
}
