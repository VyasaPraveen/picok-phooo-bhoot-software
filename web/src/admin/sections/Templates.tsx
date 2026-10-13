import { ref, remove, set } from 'firebase/database';
import { useState } from 'react';
import { isActiveOn, PRINT_SIZES, SIZE_ORDER, templateHeight, templateWidth, type PrintSizeKey, type TemplateDef } from '../../render';
import { db } from '../../shared/firebase';
import { orderTemplates, type SourcedTemplate } from '../../shared/templates';
import { clearThumbCache, TemplateThumb } from '../../shared/Thumb';
import { Toggle, useToast } from '../../shared/ui';
import { imageFileToPng, Panel, saveSettings, type SectionProps } from '../fields';

export function TemplatesSection({ boothId, data }: SectionProps) {
  const toast = useToast();
  const s = data.settings;
  const [size, setSize] = useState<PrintSizeKey>('4x6');
  const [adding, setAdding] = useState(false);
  const ordered = orderTemplates(data.templates, s);
  const list = ordered.filter((t) => t.size === size);

  const move = (id: string, dir: -1 | 1) => {
    const subset = list.map((t) => t.id);
    const i = subset.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= subset.length) return;
    [subset[i], subset[j]] = [subset[j], subset[i]];
    let k = 0;
    const merged = ordered.map((t) => (t.size === size ? subset[k++] : t.id));
    void saveSettings(boothId, { templateOrder: merged });
  };

  const toggle = (id: string, visible: boolean) => {
    const hidden = new Set(s.hiddenTemplates);
    if (visible) hidden.delete(id);
    else hidden.add(id);
    void saveSettings(boothId, { hiddenTemplates: [...hidden] });
  };

  const removeCustom = async (t: SourcedTemplate) => {
    if (!confirm(`Delete your frame “${t.name}”?`)) return;
    await remove(ref(db, `booths/${boothId}/customTemplates/${t.id}`));
    const src = t.layers?.find((l) => l.type === 'image')?.src;
    if (typeof src === 'string' && src.startsWith('asset:')) await remove(ref(db, `booths/${boothId}/assets/${src.slice(6)}`)).catch(() => undefined);
    toast('Frame deleted.');
  };

  const packs = data.templates.filter((t) => t.packId && t.packId !== 'builtin' && t.packId !== 'custom');

  return (
    <>
      <Panel
        title="Templates"
        subtitle="Switch off designs that do not suit the event and arrange the order customers see."
        actions={<button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>＋ Add your own frame</button>}
      >
        <div className="chip-row">
          {SIZE_ORDER.map((k) => (
            <button key={k} className="chip" aria-pressed={size === k} onClick={() => setSize(k)}>{PRINT_SIZES[k].shortLabel}</button>
          ))}
        </div>
        <div className="template-admin-list">
          {list.map((t, i) => {
            const live = isActiveOn(t, new Date());
            const dates = [t.activeFrom && `from ${t.activeFrom}`, t.activeTo && `until ${t.activeTo}`].filter(Boolean).join(' ');
            return (
              <div key={t.id} className="template-admin-row">
                <div className="reorder">
                  <button aria-label="Move up" disabled={i === 0} onClick={() => move(t.id, -1)}>▲</button>
                  <button aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(t.id, 1)}>▼</button>
                </div>
                <div className="mini-thumb"><TemplateThumb template={t} scale={0.08} /></div>
                <div className="grow">
                  <strong>{t.name}</strong>
                  <div className="dim small">
                    {t.category.toUpperCase()} · {t.slots.length} photo{t.slots.length === 1 ? '' : 's'}
                    {t.landscape ? ' · landscape' : ''}
                    {dates ? ` · ${dates}` : ''}
                    {live ? '' : ' (not live today)'}
                  </div>
                </div>
                {t.category === 'custom' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => void removeCustom(t)}>Delete</button>
                )}
                <Toggle label={`Show ${t.name}`} checked={!s.hiddenTemplates.includes(t.id)} onChange={(v) => toggle(t.id, v)} />
              </div>
            );
          })}
        </div>
      </Panel>
      <Panel
        title="EPIXS template cloud"
        subtitle="Festival and event packs are published with the website (web/public/cloud) and switch on and off by date automatically."
      >
        {packs.length === 0 ? (
          <p className="dim">No packs published.</p>
        ) : (
          <ul className="plain-list">
            {packs.map((t) => (
              <li key={t.id}>
                <strong>{t.name}</strong> <span className="dim">· {PRINT_SIZES[t.size].shortLabel} · {t.activeFrom ?? 'always'} → {t.activeTo ?? '…'}{isActiveOn(t, new Date()) ? ' · LIVE' : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {adding && <AddFrameDialog boothId={boothId} size={size} templates={data.templates} onClose={() => setAdding(false)} />}
    </>
  );
}

function AddFrameDialog({ boothId, size, templates, onClose }: { boothId: string; size: PrintSizeKey; templates: SourcedTemplate[]; onClose: () => void }) {
  const toast = useToast();
  const bases = templates.filter((t) => t.size === size && t.id.startsWith('std_classic_'));
  const [baseId, setBaseId] = useState(bases[0]?.id ?? '');
  const [name, setName] = useState('My frame');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const base = bases.find((b) => b.id === baseId);

  const save = async () => {
    if (!base || !file) return;
    setBusy(true);
    try {
      const w = templateWidth(base);
      const h = templateHeight(base);
      if (file.type !== 'image/png') throw new Error('The frame must be a PNG with transparent windows for the photos.');
      const bmp = await createImageBitmap(file);
      const ratio = bmp.width / bmp.height;
      bmp.close();
      if (Math.abs(ratio / (w / h) - 1) > 0.02) {
        throw new Error(`The frame must be ${w} × ${h} px (or the same shape); this one would be stretched.`);
      }
      const png = await imageFileToPng(file, Math.max(w, h));
      const id = `custom_${Date.now()}`;
      const assetId = `frame-${Date.now()}`;
      await set(ref(db, `booths/${boothId}/assets/${assetId}`), { name: file.name.slice(0, 120), mime: 'image/png', data: png.data, width: png.width, height: png.height, updatedAt: Date.now() });
      const t: TemplateDef = {
        id,
        name: name.trim().slice(0, 60) || 'My frame',
        category: 'custom',
        description: `Your own frame · ${base.slots.length} photo${base.slots.length === 1 ? '' : 's'}`,
        size: base.size,
        landscape: !!base.landscape,
        filter: 'none',
        background: { color: '#FFFFFF' },
        layers: [{ type: 'image', src: `asset:${assetId}`, x: 0, y: 0, w, h, fit: 'fill', z: 'above' }],
        slots: base.slots,
        logo: base.logo,
      };
      await set(ref(db, `booths/${boothId}/customTemplates/${id}`), JSON.parse(JSON.stringify(t)));
      clearThumbCache();
      toast('Frame added. Customers can choose it now.');
      onClose();
    } catch (e) {
      toast((e as Error).message || 'Could not add the frame.', true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add your own frame" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="dialog card" onClick={(e) => e.stopPropagation()}>
        <h2>Add your own frame · {PRINT_SIZES[size].label}</h2>
        <label>Photo layout your frame was designed for
          <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
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
          </p>
        )}
        <label>Template name<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>PNG frame<input type="file" accept="image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <div className="row-gap end">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={!file || !base || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Add frame'}</button>
        </div>
      </div>
    </div>
  );
}
