import { ref, update } from 'firebase/database';
import { useEffect, useState } from 'react';
import { MEDIA_ROLLS, PRINT_SIZES, SIZE_ORDER } from '../../render';
import { assetDataUrl, forgetAsset, PICOK_LOGO } from '../../shared/booth';
import { db } from '../../shared/firebase';
import { DEFAULT_CONSENT, DEFAULT_PRICES, encodePrices } from '../../shared/model';
import { visibleFor } from '../../shared/templates';
import { clearThumbCache, TemplateThumb } from '../../shared/Thumb';
import { Segmented, Toggle, useToast } from '../../shared/ui';
import { CommitInput, imageFileToPng, Panel, Row, RupeeInput, saveSettings, Stepper, type SectionProps } from '../fields';

type LogoField = 'logoAssetId' | 'logoLightAssetId';

export function BrandingSection({ boothId, data }: SectionProps) {
  const toast = useToast();
  const s = data.settings;
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [lightUrl, setLightUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<LogoField | null>(null);
  const size = MEDIA_ROLLS[s.loadedRoll].sizes[0];
  const sample = visibleFor(data.templates, s, size)[0];

  useEffect(() => {
    if (!s.logoAssetId) return setLogoUrl(null);
    void assetDataUrl(boothId, s.logoAssetId).then(setLogoUrl);
  }, [boothId, s.logoAssetId]);
  useEffect(() => {
    if (!s.logoLightAssetId) return setLightUrl(null);
    void assetDataUrl(boothId, s.logoLightAssetId).then(setLightUrl);
  }, [boothId, s.logoLightAssetId]);

  const save = async (patch: Parameters<typeof saveSettings>[1]) => {
    await saveSettings(boothId, patch);
    clearThumbCache();
  };

  const upload = async (file: File | undefined, field: LogoField) => {
    if (!file) return;
    setBusy(field);
    try {
      const png = await imageFileToPng(file, 1000);
      const id = `${field === 'logoAssetId' ? 'logo' : 'logolight'}-${Date.now()}`;
      const old = s[field];
      // The logo, its setting and the old logo's removal are saved together or not at all.
      await update(ref(db, `booths/${boothId}`), {
        [`assets/${id}`]: { name: file.name.slice(0, 120), mime: png.mime, data: png.data, width: png.width, height: png.height, updatedAt: Date.now() },
        [`settings/${field}`]: id,
        ...(old ? { [`assets/${old}`]: null } : {}),
      });
      if (old) forgetAsset(boothId, old);
      clearThumbCache();
      toast(field === 'logoAssetId' ? 'Client logo updated. It now appears on every print.' : 'Light-background logo updated.');
    } catch (e) {
      toast((e as Error).message || 'Upload failed.', true);
    } finally {
      setBusy(null);
    }
  };

  const clearLogo = async () => {
    const old = [s.logoAssetId, s.logoLightAssetId].filter((x): x is string => !!x);
    try {
      await update(ref(db, `booths/${boothId}`), {
        'settings/logoAssetId': null,
        'settings/logoLightAssetId': null,
        ...Object.fromEntries(old.map((id) => [`assets/${id}`, null])),
      });
      old.forEach((id) => forgetAsset(boothId, id));
      clearThumbCache();
    } catch {
      toast('Could not switch to the Picok logo. Check your connection.', true);
    }
  };

  const uploadButton = (field: LogoField, label: string) => (
    <label className={`btn btn-primary btn-sm ${busy ? 'disabled' : ''}`}>
      {busy === field ? 'Uploading…' : label}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="visually-hidden"
        disabled={!!busy}
        onChange={(e) => {
          void upload(e.target.files?.[0], field);
          e.target.value = '';
        }}
      />
    </label>
  );

  return (
    <div className="grid-main-side">
      <div>
        <Panel
          title="Booth theme"
          subtitle="Light or dark for this event: the booth screens, the standard print style (Classic White or Picok Midnight) and the logo version all follow it."
        >
          <Row label="Theme">
            <Segmented
              label="Booth theme"
              value={s.theme}
              options={[
                { value: 'dark', label: '● Dark' },
                { value: 'light', label: '○ Light' },
              ]}
              onChange={(v) => void save({ theme: v })}
            />
          </Row>
        </Panel>
        <Panel
          title="Client brand logo"
          subtitle="Printed at the bottom of every print. A transparent PNG works best. Add a dark-text version for light backgrounds so the logo stays visible in the light theme."
        >
          <div className="logo-row">
            <div className="logo-box" title="On dark backgrounds">
              <img src={logoUrl ?? PICOK_LOGO.dark} alt="Print logo on dark backgrounds" />
            </div>
            <div className="logo-box light" title="On light backgrounds">
              <img src={s.logoAssetId ? (lightUrl ?? logoUrl ?? PICOK_LOGO.light) : PICOK_LOGO.light} alt="Print logo on light backgrounds" />
            </div>
            {uploadButton('logoAssetId', '⬆ Upload logo')}
            {s.logoAssetId && uploadButton('logoLightAssetId', s.logoLightAssetId ? '⬆ Replace light version' : '⬆ Light-background version')}
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
