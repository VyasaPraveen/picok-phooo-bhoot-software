import { ref, remove, set } from 'firebase/database';
import { useEffect, useState } from 'react';
import { MEDIA_ROLLS, PRINT_SIZES, SIZE_ORDER } from '../../render';
import { assetDataUrl, forgetAsset } from '../../shared/booth';
import { db } from '../../shared/firebase';
import { DEFAULT_CONSENT, DEFAULT_PRICES, encodePrices } from '../../shared/model';
import { visibleFor } from '../../shared/templates';
import { clearThumbCache, TemplateThumb } from '../../shared/Thumb';
import { Segmented, Toggle, useToast } from '../../shared/ui';
import { CommitInput, imageFileToPng, Panel, Row, RupeeInput, saveSettings, Stepper, type SectionProps } from '../fields';

export function BrandingSection({ boothId, data }: SectionProps) {
  const toast = useToast();
  const s = data.settings;
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const size = MEDIA_ROLLS[s.loadedRoll].sizes[0];
  const sample = visibleFor(data.templates, s, size)[0];

  useEffect(() => {
    if (!s.logoAssetId) return setLogoUrl(null);
    void assetDataUrl(boothId, s.logoAssetId).then(setLogoUrl);
  }, [boothId, s.logoAssetId]);

  const save = async (patch: Parameters<typeof saveSettings>[1]) => {
    await saveSettings(boothId, patch);
    clearThumbCache();
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const png = await imageFileToPng(file, 1000);
      const id = `logo-${Date.now()}`;
      await set(ref(db, `booths/${boothId}/assets/${id}`), {
        name: file.name.slice(0, 120),
        mime: 'image/png',
        data: png.data,
        width: png.width,
        height: png.height,
        updatedAt: Date.now(),
      });
      const old = s.logoAssetId;
      await save({ logoAssetId: id });
      if (old) {
        forgetAsset(boothId, old);
        await remove(ref(db, `booths/${boothId}/assets/${old}`)).catch(() => undefined);
      }
      toast('Client logo updated. It now appears on every print.');
    } catch (e) {
      toast((e as Error).message || 'Upload failed.', true);
    } finally {
      setBusy(false);
    }
  };

  const clearLogo = async () => {
    const old = s.logoAssetId;
    await save({ logoAssetId: null });
    if (old) await remove(ref(db, `booths/${boothId}/assets/${old}`)).catch(() => undefined);
  };

  return (
    <div className="grid-main-side">
      <div>
        <Panel title="Client brand logo" subtitle="Printed at the bottom of every print. A transparent PNG works best.">
          <div className="logo-row">
            <div className="logo-box">
              <img src={logoUrl ?? '/brand/picok_logo_transparent.png'} alt="Current print logo" />
            </div>
            <label className={`btn btn-primary btn-sm ${busy ? 'disabled' : ''}`}>
              {busy ? 'Uploading…' : '⬆ Upload logo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="visually-hidden"
                disabled={busy} onChange={(e) => {
                  void upload(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            {s.logoAssetId && <button className="btn btn-ghost btn-sm" onClick={() => void clearLogo()}>Use Picok logo</button>}
          </div>
          <Row label="Logo strip colour" help="Follow each template, or force white / black for this client’s logo">
            <Segmented
              label="Logo strip colour"
              value={s.logoStripBg}
              options={[
                { value: 'template', label: 'Template' },
                { value: '#FFFFFF', label: 'White' },
                { value: '#000000', label: 'Black' },
              ]}
              onChange={(v) => void save({ logoStripBg: v })}
            />
          </Row>
        </Panel>
        <Panel title="Event">
          <Row label="Event name" help="Shown on the start screen and on prints">
            <CommitInput value={s.eventName} placeholder="e.g. Ravi weds Priya" onCommit={(v) => void save({ eventName: v.slice(0, 80) })} />
          </Row>
          <Row label="Event date">
            <CommitInput value={s.eventDate} placeholder="e.g. 13 Oct 2026" onCommit={(v) => void save({ eventDate: v.slice(0, 40) })} />
          </Row>
          <Row label="Show event name & date on prints">
            <Toggle label="Show event on prints" checked={s.showEventOnPrint} onChange={(v) => void save({ showEventOnPrint: v })} />
          </Row>
          <Row label="Business name">
            <CommitInput value={s.businessName} onCommit={(v) => void save({ businessName: v.slice(0, 60) || 'Picok' })} />
          </Row>
        </Panel>
        <Panel title="Photo consent notice" subtitle="Shown on the start screen. You are responsible for displaying consent at events.">
          <Row label="Show notice">
            <Toggle label="Show consent notice" checked={s.showConsent} onChange={(v) => void save({ showConsent: v })} />
          </Row>
          <CommitInput width="100%" value={s.consentText} onCommit={(v) => void save({ consentText: v.slice(0, 400) || DEFAULT_CONSENT })} />
        </Panel>
      </div>
      <Panel title="Preview">
        {sample ? <TemplateThumb template={sample} scale={0.3} className="preview-img" /> : <p className="dim">No template for the loaded media.</p>}
      </Panel>
    </div>
  );
}

export function PricesSection({ boothId, data }: SectionProps) {
  const s = data.settings;
  const roll = MEDIA_ROLLS[s.loadedRoll];
  return (
    <>
      <Panel
        title="Free event"
        subtitle="For prepaid corporate events: customers skip payment entirely."
        actions={<Toggle label="Free event" checked={s.freeMode} onChange={(v) => void saveSettings(boothId, { freeMode: v })} />}
      >
        {s.freeMode && <p className="warn">Free mode is ON — no payment is asked. Orders are logged as “Free event”.</p>}
      </Panel>
      <Panel title="Prices (₹)" subtitle="Total = first copy (colour or B&W) + extra copies × extra-copy price">
        <div className="table-scroll"><table className="table">
          <thead><tr><th>Size</th><th>Colour</th><th>B&W</th><th>Each extra copy</th></tr></thead>
          <tbody>
            {SIZE_ORDER.map((k) => {
              const p = s.prices[k] ?? DEFAULT_PRICES[k];
              const setP = (patch: Partial<typeof p>) =>
                void saveSettings(boothId, { prices: encodePrices({ ...s.prices, [k]: { ...p, ...patch } }) });
              return (
                <tr key={k} className={roll.sizes.includes(k) ? '' : 'muted'}>
                  <td>{PRINT_SIZES[k].label}{roll.sizes.includes(k) ? '' : ' (other roll)'}</td>
                  <td><RupeeInput paise={p.colour} onChange={(v) => setP({ colour: v })} /></td>
                  <td><RupeeInput paise={p.bw} onChange={(v) => setP({ bw: v })} /></td>
                  <td><RupeeInput paise={p.extraCopy} onChange={(v) => setP({ extraCopy: v })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </Panel>
      <Panel title="Copies">
        <Row label="Maximum copies per order" help="Customers choose between 1 and this number">
          <Stepper value={s.maxCopies} min={1} max={10} onChange={(v) => void saveSettings(boothId, { maxCopies: v })} />
        </Row>
      </Panel>
    </>
  );
}
