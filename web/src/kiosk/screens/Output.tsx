import { useContext, useEffect, useRef, useState } from 'react';
import { canvasToBlob, PRINT_SIZES, renderTemplate, stripSheet } from '../../render';
import { layerImagesFor } from '../../shared/booth';
import { printsOut } from '../../shared/model';
import { RenderEnvContext, renderExtras } from '../../shared/Thumb';
import { followJob, submitPrintJob, updateOrder, consumePaper } from '../boothOps';
import type { StepProps } from '../Flow';
import { deletePrint, markPrinted, savePrint } from '../printStore';
import { StepHeader } from './Choose';

/** Step 7 · Preview: the photos in the chosen template with the brand logo, exactly as they will print. */
export function PreviewScreen({ boothId, data, session, go, reset }: StepProps) {
  const env = useContext(RenderEnvContext)!;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(data.settings.previewAutoPrintSeconds);
  const sent = useRef(false);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    (async () => {
      const t = session.template!;
      const layerImages = await layerImagesFor(boothId, t);
      const canvas = await renderTemplate(
        { template: t, photos: session.photos, bw: session.bw, mirror: data.settings.mirrorPhotos, layerImages, ...renderExtras(env) },
        1,
      );
      const sheet = PRINT_SIZES[t.size].isStrip ? stripSheet(canvas) : canvas;
      const blob = await canvasToBlob(sheet, 'image/jpeg', 0.95);
      session.printBlob = blob;
      if (session.order) await savePrint(session.order.id, blob).catch(() => undefined);
      if (!alive) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    })().catch(() => alive && setError('We could not create your print. Your order is saved — please call the operator.'));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  const print = () => {
    if (sent.current || !session.printBlob) return;
    sent.current = true;
    go('printing');
  };

  useEffect(() => {
    if (!url) return;
    if (left <= 0) {
      print();
      return;
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [url, left]);

  // The order stays paid; staff resume it from the operator panel.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(reset, 60_000);
    return () => clearTimeout(t);
  }, [error, reset]);

  const size = PRINT_SIZES[session.size!];
  return (
    <div className="screen">
      <StepHeader step={7} title="Your print" subtitle={`${size.label} · ${session.template!.name}`} />
      <div className="preview-layout">
        <div className="preview-image">
          {url ? (
            <img src={url} alt="Print preview" className="shadowed" />
          ) : error ? (
            <p className="problem-text">{error}</p>
          ) : (
            <div className="center-col"><div className="spinner" /><p>Creating your print…</p></div>
          )}
        </div>
        <aside className="capture-side">
          {size.isStrip && <p className="dim">You get two strips — one for you, one for a friend!</p>}
          {error ? (
            <button className="btn btn-ghost btn-xl" onClick={reset}>Back to start</button>
          ) : (
            <button className="btn btn-primary btn-xl" disabled={!url} onClick={print}>Print it! 🖨</button>
          )}
          {url && <p className="dim">Printing automatically in {left} s</p>}
        </aside>
      </div>
    </div>
  );
}

type PrintPhase = 'sending' | 'printing' | 'done' | 'failed';

/** Step 8 · Print: sent to the DNP printer through the Print Bridge, then back to Step 1. */
export function PrintingScreen({ boothId, data, session, reset }: StepProps) {
  const s = data.settings;
  const order = session.order!;
  const [phase, setPhase] = useState<PrintPhase>('sending');
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const started = useRef(false);
  const demo = s.printMode === 'demo';

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const blob = session.printBlob;
      if (!blob) throw new Error('The print file is missing.');
      if (demo) {
        setPhase('printing');
        await new Promise((r) => setTimeout(r, 3500));
        void updateOrder(boothId, order.id, { status: 'printed', error: null }).catch(() => undefined);
        await markPrinted(order.id).catch(() => undefined);
        setDownloadUrl(URL.createObjectURL(blob));
        setPhase('done');
        return;
      }
      const key = data.bridge?.publicKey;
      if (!key) throw new Error('The print PC is not connected.');
      const jobId = await submitPrintJob(boothId, {
        orderId: order.id,
        media: order.size,
        finish: s.finish,
        copies: order.copies,
        reprint: !!order.reprintOf,
        file: blob,
        publicKey: key,
      });
      void updateOrder(boothId, order.id, { status: 'printing', jobId, error: null }).catch(() => undefined);
      setPhase('printing');
      const result = await followJob(boothId, jobId, (st, msg) => setProblem(st === 'error' ? msg || 'Printer needs attention' : null));
      if (result.status === 'done') {
        void updateOrder(boothId, order.id, { status: 'printed', error: null }).catch(() => undefined);
        void consumePaper(boothId, order.copies).catch(() => undefined);
        if (s.retentionMinutes === 0) await deletePrint(order.id).catch(() => undefined);
        else await markPrinted(order.id).catch(() => undefined);
        setPhase('done');
      } else {
        const msg = result.message || 'The printer reported a problem.';
        // Once the print PC has the file, the print may still come out after staff fix the printer.
        throw new Error(result.claimed ? `${msg} · It may still print once the printer is fixed: check the tray before reprinting.` : msg);
      }
    })().catch(async (e: Error) => {
      setMessage(e.message);
      setPhase('failed');
      void updateOrder(boothId, order.id, { status: 'failed', error: e.message }).catch(() => undefined);
    });
  }, []);

  useEffect(() => {
    if (phase !== 'done' && phase !== 'failed') return;
    const t = setTimeout(reset, (phase === 'done' ? (demo ? 25 : 9) : 30) * 1000);
    return () => clearTimeout(t);
  }, [phase, reset, demo]);

  useEffect(() => () => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  }, [downloadUrl]);

  const n = printsOut(order);
  const what = order.size === '2x6' ? `${n} strip${n === 1 ? '' : 's'}` : `${n} print${n === 1 ? '' : 's'}`;

  return (
    <div className="screen">
      <StepHeader step={8} title={phase === 'done' ? `Enjoy your ${what}!` : 'Printing'} subtitle={`Order ${order.id}`} />
      <div className="center-col grow-1">
        {(phase === 'sending' || phase === 'printing') && (
          <>
            <div className="lens-spin" aria-hidden />
            <h1>{phase === 'sending' ? 'Sending to the printer…' : `Printing your ${what}…`}</h1>
            {problem ? (
              <p className="warn-text" role="alert">Printer needs attention: {problem}<br />Please call the operator — your print will continue.</p>
            ) : (
              <p className="dim">It takes about 12 seconds per print. Please collect it from the printer tray.</p>
            )}
          </>
        )}
        {phase === 'done' && (
          <div className="pop center-col">
            <div className="big-heart">♥</div>
            <h1 className="huge">Thank you!</h1>
            <p className="dim">{demo ? 'Demo mode: this is the file the printer would receive.' : `Collect your ${what} from the printer tray.`}</p>
            <div className="row-gap">
              {downloadUrl && (
                <a className="btn btn-soft" href={downloadUrl} download={`picok-${order.id}.jpg`}>⬇ Download print</a>
              )}
              <button className="btn btn-primary" onClick={reset}>Done ✓</button>
            </div>
          </div>
        )}
        {phase === 'failed' && (
          <div className="center-col" role="alert">
            <div className="big-warn">!</div>
            <h1>Oops — the printer needs a hand</h1>
            <p className="problem-text">
              Your order {order.id} is saved and paid. Please call the operator to reprint it.
              {message && <><br /><span className="dim">({message})</span></>}
            </p>
            <button className="btn btn-ghost" onClick={reset}>OK</button>
          </div>
        )}
      </div>
    </div>
  );
}
