/**
 * Adapted from https://github.com/crayon-nickee/videotoframes
 * Extracts frames (specifically the final frame) from a processed watermark-free video
 * in full lossless original resolution (PNG).
 */

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      if (err) reject(err);
      else resolve();
    };
    const onSeeked = () => finish();
    const onError = () => finish(new Error('unreadable'));
    const timer = setTimeout(() => finish(new Error('unreadable')), 8000);

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);

    if (Math.abs(video.currentTime - time) < 0.001) {
      finish();
      return;
    }

    try {
      video.currentTime = time;
    } catch (err) {
      finish(err instanceof Error ? err : new Error('unreadable'));
    }
  });
}

function knownLength(video: HTMLVideoElement): number {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  if (video.seekable?.length) {
    const end = video.seekable.end(video.seekable.length - 1);
    if (Number.isFinite(end) && end > 0) return end;
  }
  return 0;
}

function waitUntilReady(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = (err?: Error) => {
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', check);
      video.removeEventListener('loadeddata', check);
      video.removeEventListener('durationchange', check);
      if (err) reject(err);
      else resolve();
    };
    const check = () => {
      if (video.videoWidth > 0 && knownLength(video) > 0) {
        finish();
      }
    };
    timer = setTimeout(() => finish(new Error('duration')), 8000);
    video.addEventListener('loadedmetadata', check);
    video.addEventListener('loadeddata', check);
    video.addEventListener('durationchange', check);
    check();
  });
}

export interface ExtractedFrame {
  blob: Blob;
  url: string;
  name: string;
  time: number;
  width: number;
  height: number;
}

/**
 * Extracts the final frame of a video Blob/File in lossless original size (image/png)
 * using the videotoframes pipeline.
 */
export function extractFinalFrame(
  fileOrBlob: Blob | File,
  baseName = 'video'
): Promise<ExtractedFrame> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(fileOrBlob);
    let settled = false;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: true });

    const close = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    };

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      close();
      reject(err instanceof Error ? err : new Error('unreadable'));
    };

    const succeed = (frame: ExtractedFrame) => {
      if (settled) return;
      settled = true;
      close();
      resolve(frame);
    };

    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.addEventListener('error', () => fail(new Error('unreadable')));

    waitUntilReady(video)
      .then(async () => {
        try {
          const duration = knownLength(video);
          if (duration <= 0) throw new Error('duration');

          // Lossless original size (no MAX_EDGE downscaling)
          const width = Math.max(1, video.videoWidth);
          const height = Math.max(1, video.videoHeight);
          canvas.width = width;
          canvas.height = height;

          // Final frame timestamp (matching videotoframes last frame calculation)
          const finalTime = Math.max(0, duration - 0.05);
          await seekTo(video, finalTime);

          if (!ctx) throw new Error('canvas');
          ctx.drawImage(video, 0, 0, width, height);

          const blob = await new Promise<Blob | null>((done) =>
            canvas.toBlob(done, 'image/png')
          );
          if (!blob) throw new Error('unreadable');

          const cleanBase = baseName.replace(/\.[^/.]+$/, '');
          succeed({
            blob,
            name: `${cleanBase}_final_frame.png`,
            time: finalTime,
            url: URL.createObjectURL(blob),
            width,
            height,
          });
        } catch (err) {
          fail(err);
        }
      })
      .catch(fail);

    video.src = url;
  });
}

// Store already-compressed files in one zip (from crayon-nickee/videotoframes/src/zip.js)
const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function u32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

export function zipStore(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const local: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = enc.encode(file.name);
    const data = file.data;
    const crc = crc32(data);

    const head = new DataView(new ArrayBuffer(30));
    u32(head, 0, 0x04034b50);
    u16(head, 4, 20);
    u32(head, 14, crc);
    u32(head, 18, data.length);
    u32(head, 22, data.length);
    u16(head, 26, name.length);
    local.push(new Uint8Array(head.buffer), new Uint8Array(name), new Uint8Array(data));

    const cen = new DataView(new ArrayBuffer(46));
    u32(cen, 0, 0x02014b50);
    u16(cen, 4, 20);
    u16(cen, 6, 20);
    u32(cen, 16, crc);
    u32(cen, 20, data.length);
    u32(cen, 24, data.length);
    u16(cen, 28, name.length);
    u32(cen, 42, offset);
    central.push(new Uint8Array(cen.buffer), name);

    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  u32(end, 0, 0x06054b50);
  u16(end, 8, files.length);
  u16(end, 10, files.length);
  u32(end, 12, centralSize);
  u32(end, 16, offset);

  return new Blob(
    [...local, ...central.map((u) => new Uint8Array(u)), new Uint8Array(end.buffer)],
    { type: 'application/zip' }
  );
}
