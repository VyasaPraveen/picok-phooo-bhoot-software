import { useEffect, useRef, useState } from 'react';
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

  useEffect(() => {
    // Per run: under StrictMode the first run's camera must be stopped even if it opens late.
    let active = true;
    alive.current = true;
    (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (!active) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play().catch(() => undefined);
        }
        setPhase('ready');
      } catch (e) {
        const name = (e as { name?: string }).name;
        setError(
          name === 'NotAllowedError'
            ? 'Camera access is blocked. The operator can allow it in the browser settings for this site.'
            : 'The camera could not start.',
        );
        setPhase('error');
      }
    })();
    return () => {
      active = false;
      alive.current = false;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

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
    if (!v || !v.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    return c;
  };

  const shoot = async () => {
    for (let n = s.countdownSeconds; n >= 1; n--) {
      if (!alive.current) return;
      setCount(n);
      setPhase('countdown');
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!alive.current) return;
    setPhase('flash');
    // Let the white flash reach the screen so it lights the faces.
    await new Promise((r) => setTimeout(r, 140));
    const canvas = grab();
    if (!canvas) {
      setError('Could not take the photo.');
      setPhase('error');
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
              <p className="dim">Look at the camera at the top of the screen.</p>
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
          {phase === 'error' && <button className="btn btn-ghost" onClick={reset}>⌂ Back to start</button>}
        </aside>
      </div>
    </div>
  );
}
