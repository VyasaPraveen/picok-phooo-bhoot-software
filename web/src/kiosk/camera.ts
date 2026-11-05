import type { CameraSource } from '../shared/model';

/**
 * Camera selection. The booth's main camera is a Canon EOS R50 connected to the tablet by USB-C:
 * in its streaming (UVC) mode it appears to Chrome as an extra camera. `auto` uses it when it is
 * plugged in and falls back to the tablet's front camera.
 */

const PIN_KEY = 'picok.cameraId';
const RESOLUTION = { width: { ideal: 1920 }, height: { ideal: 1080 } };

/** A camera chosen in the staff menu on this tablet (overrides the booth setting). */
export const pinnedCamera = (): string | null => {
  try {
    return localStorage.getItem(PIN_KEY);
  } catch {
    return null;
  }
};

export const pinCamera = (deviceId: string | null) => {
  try {
    if (deviceId) localStorage.setItem(PIN_KEY, deviceId);
    else localStorage.removeItem(PIN_KEY);
  } catch {
    // Storage blocked: the booth setting applies.
  }
};

/** The facing direction Chrome reports for a camera: empty for external (USB) cameras. */
function facingOf(d: MediaDeviceInfo): string[] | null {
  const caps = (d as MediaDeviceInfo & { getCapabilities?: () => { facingMode?: string[] } }).getCapabilities?.();
  return caps ? caps.facingMode ?? [] : null;
}

/**
 * Whether a camera is a USB camera (the Canon R50 in streaming mode).
 * - A label naming Canon/EOS/USB/UVC/external is external.
 * - On Android, built-in cameras report a facing direction (user/environment) while an external
 *   camera reports none, even when Chrome labels it "facing back".
 * - A camera without "facing front/back" in its label among Android-style labels is external.
 */
export function isUsbCamera(d: MediaDeviceInfo, all: MediaDeviceInfo[]): boolean {
  const label = d.label.toLowerCase();
  if (/canon|eos|usb|uvc|external/.test(label)) return true;
  const androidStyle = all.some((x) => /facing (front|back)/.test(x.label.toLowerCase()));
  if (!androidStyle || !label) return false;
  const facing = facingOf(d);
  const builtinsReportFacing = all.some((x) => x !== d && (facingOf(x)?.length ?? 0) > 0);
  if (facing !== null && facing.length === 0 && builtinsReportFacing) return true;
  return !/facing (front|back)/.test(label);
}

/** The best USB camera: a Canon by name first, then any other external camera. */
const pickUsb = (cams: MediaDeviceInfo[]) =>
  cams.find((d) => /canon|eos/i.test(d.label)) ?? cams.find((d) => isUsbCamera(d, cams));

/** Video inputs with labels (asks for camera permission once if needed). */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  let devices = await navigator.mediaDevices.enumerateDevices();
  if (!devices.some((d) => d.kind === 'videoinput' && d.label)) {
    const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    probe.getTracks().forEach((t) => t.stop());
    devices = await navigator.mediaDevices.enumerateDevices();
  }
  return devices.filter((d) => d.kind === 'videoinput');
}

export class UsbCameraMissing extends Error {
  constructor() {
    super('The USB camera (Canon EOS R50) is not connected. Check the cable and that the camera is in streaming (webcam) mode.');
  }
}

/** Opens the camera for the booth. `usb` tells the screen which camera is in use. */
export async function openCamera(source: CameraSource): Promise<{ stream: MediaStream; usb: boolean }> {
  const byId = async (deviceId: string) =>
    navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, ...RESOLUTION }, audio: false });
  const facing = (mode: 'user' | 'environment') =>
    navigator.mediaDevices.getUserMedia({ video: { facingMode: mode, ...RESOLUTION }, audio: false });

  const pinned = pinnedCamera();
  if (pinned) {
    try {
      const stream = await byId(pinned);
      const cams = await navigator.mediaDevices.enumerateDevices();
      const dev = cams.find((d) => d.deviceId === pinned);
      return { stream, usb: !!dev && isUsbCamera(dev, cams) };
    } catch {
      // Unplugged or no longer available: fall through to the booth setting.
    }
  }
  if (source === 'front') return { stream: await facing('user'), usb: false };
  if (source === 'back') return { stream: await facing('environment'), usb: false };

  const cams = await listCameras();
  const usb = pickUsb(cams);
  if (usb) {
    try {
      return { stream: await byId(usb.deviceId), usb: true };
    } catch (e) {
      if (source === 'usb') throw e;
    }
  }
  if (source === 'usb') throw new UsbCameraMissing();
  return { stream: await facing('user'), usb: false };
}
