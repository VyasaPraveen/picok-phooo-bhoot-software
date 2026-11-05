import { useEffect, useRef, useState } from 'react';
import { openCamera, UsbCameraMissing } from '../camera';
import type { StepProps } from '../Flow';
import { StepHeader } from './Choose';

type Phase = 'starting' | 'ready' | 'countdown' | 'flash' | 'review' | 'error';

/** Step 6 · Smile! 3 · 2 · 1 — countdown, screen flash, one shot per photo slot, retakes as set. */
export function CaptureScreen({ data, session, go, reset }: StepProps) {
  const s = data.settings;
  const slots = session.template!.slots;
  const total = slots.length;
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  const [review, setReview] = useState<{ canvas: HTMLCanvasElement; url: string } | null>(null);
  const [retakesLeft, setRetakesLeft] = useState(s.retakesAllowed);
  const [reviewLeft, setReviewLeft] = useState(0);
  const photos = useRef<HTMLCanvasElement[]>([]);
  const alive = useRef(true);
  const [usbCamera, setUsbCamera] = useState(false);
  /** Bumped by "Try again" to reopen the camera. */
  const [attempt, setAttempt] = useState(0);
  /** The camera failed or was unplugged: a running countdown must stop. */
  const broken = useRef(false);
  /** Each countdown run gets a token; "Try again" or a camera failure ends the old run. */
  const run = useRef(0);
  const fail = (message: string) => {
    broken.current = true;
    run.current++;
    setError(message);
    setPhase('error');
  };

  useEffect(() => {
    // Per run: under StrictMode the first run's camera must be stopped even if it opens late.
    let active = true;
    alive.current = true;
    (async () => {
      try {
        broken.current = false;
        setPhase('starting');
        const { stream: media, usb } = await openCamera(s.cameraSource);
        if (!active) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = media;
        setUsbCamera(usb);
        // A USB camera that is unplugged or switched off mid-session.
        media.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (active) fail('The camera was disconnected. Reconnect it and tap Try again.');
        });
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play().catch(() => undefined);
        }
        setPhase('ready');
      } catch (e) {
        if (!active) return;
        const name = (e as { name?: string }).name;
        fail(
          e instanceof UsbCameraMissing
            ? e.message
            : name === 'NotAllowedError'
              ? 'Camera access is blocked. The operator can allow it in the browser settings for this site.'
              : name === 'NotReadableError'
                ? 'The camera is busy or switched off. Check the camera and tap Try again.'
                : 'The camera could not start.',
        );
      }
    })();
    return () => {
      active = false;
      alive.current = false;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
  }, [attempt]);

  // A customer who paid but never started is sent back; the paid order stays for the operator.
  useEffect(() => {
    if (phase !== 'ready' || index !== 0) return;
    const t = setTimeout(reset, Math.max(90, s.inactivitySeconds * 2) * 1000);
    return () => clearTimeout(t);
  }, [phase, index, reset, s.inactivitySeconds]);

  useEffect(() => {
    if (phase !== 'error') return;
    const t = setTimeout(reset, 60_000);
    return () => clearTimeout(t);
  }, [phase, reset]);

  const grab = (): HTMLCanvasElement | null => {
    const v = video.current;
    const live = stream.current?.getVideoTracks()[0]?.readyState === 'live';
    if (!v || !v.videoWidth || !live || broken.current) return null;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    return c;
  };

  const shoot = async () => {
    const token = ++run.current;
    const stopped = () => !alive.current || broken.current || token !== run.current;
    for (let n = s.countdownSeconds; n >= 1; n--) {
      if (stopped()) return;
      setCount(n);
      setPhase('countdown');
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (stopped()) return;
    setPhase('flash');
    // Let the white flash reach the screen so it lights the faces.
    await new Promise((r) => setTimeout(r, 140));
    if (stopped()) return;
    const canvas = grab();
    if (!canvas) {
      fail('Could not take the photo. Check the camera and tap Try again.');
      return;
    }
    setReview({ canvas, url: canvas.toDataURL('image/jpeg', 0.85) });
    setReviewLeft(5);
    setPhase('review');
  };

  const keep = () => {
    if (!review) return;
    photos.current[index] = review.canvas;
    setReview(null);
    if (index + 1 >= total) {
      session.photos = photos.current;
      go('preview');
      return;
    }
    setIndex(index + 1);
    setRetakesLeft(s.retakesAllowed);
    void shoot();
  };

  useEffect(() => {
    if (phase !== 'review') return;
    if (reviewLeft <= 0) {
      keep();
      return;
    }
    const t = setTimeout(() => setReviewLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, reviewLeft]);

  const slot = slots[Math.min(index, total - 1)];
  const last = index + 1 >= total;

  return (
    <div className="screen">
      {phase === 'flash' && <div className="flash" aria-hidden />}
      <StepHeader step={6} title={phase === 'review' ? 'How does that look?' : 'Smile!'} subtitle={`Photo ${Math.min(index + 1, total)} of ${total}`} />
      <div className="capture-layout">
        <div className="viewport-wrap">
        <div className="viewport" style={{ aspectRatio: `${slot.w} / ${slot.h}`, width: `min(100cqw, calc(100cqh * ${slot.w / slot.h}))` }}>
          <video ref={video} playsInline muted className="live" style={{ visibility: phase === 'review' ? 'hidden' : 'visible' }} />
          {phase === 'review' && review && (
            <img src={review.url} alt="Your photo" className={`still ${s.mirrorPhotos ? 'mirrored' : ''}`} />
          )}
          {phase === 'countdown' && <div className="countdown" key={count}>{count}</div>}
          {phase === 'error' && <div className="viewport-msg">{error}<br />Your order is saved — please call the operator.</div>}
          {phase === 'starting' && <div className="viewport-msg"><div className="spinner" /></div>}
        </div>
        </div>
        <aside className="capture-side">
          {phase === 'ready' && (
            <>
              <h2>We’ll take {total} photo{total === 1 ? '' : 's'}.</h2>
              <p className="dim">{usbCamera ? 'Look at the camera lens above the screen.' : 'Look at the camera at the top of the screen.'}</p>
              <button className="btn btn-primary btn-xl" onClick={() => void shoot()}>I’m ready! 📸</button>
            </>
          )}
          {phase === 'review' && (
            <>
              <button className="btn btn-primary" onClick={keep}>{last ? 'Looks great! ✓' : 'Next photo ✓'}</button>
              <p className="dim">Continuing in {reviewLeft} s</p>
              {retakesLeft > 0 && (
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setRetakesLeft((n) => n - 1);
                    setReview(null);
                    void shoot();
                  }}
                >
                  ↻ Retake ({retakesLeft} left)
                </button>
              )}
            </>
          )}
          {phase === 'error' && (
            <>
              <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>↻ Try again</button>
              <button className="btn btn-ghost" onClick={reset}>⌂ Back to start</button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
