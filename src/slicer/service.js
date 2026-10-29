import { renderThumbnail, thumbnailBlock } from './thumbs.js';

// Main-thread facade for the slicing web worker.
export class SlicerService {
  constructor() {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.jobs = new Map();
    this.nextId = 1;
    this.worker.onmessage = (e) => {
      const { id, progress, stage, result, error } = e.data;
      const job = this.jobs.get(id);
      if (!job) return;
      if (progress !== undefined && !result) job.onProgress?.(progress, stage);
      if (result) {
        this.jobs.delete(id);
        job.resolve(result);
      }
      if (error) {
        this.jobs.delete(id);
        job.reject(new Error(error));
      }
    };
  }

  slice(positions, settings, onProgress) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject, onProgress });
      // copy so the caller keeps its array
      const copy = new Float32Array(positions);
      this.worker.postMessage({ id, positions: copy, settings }, [copy.buffer]);
    });
  }

  // Slice and produce a USB file object (G-code with embedded thumbnail)
  async makeFile(name, positions, settings, onProgress, color) {
    const r = await this.slice(positions, settings, onProgress);
    const thumb = renderThumbnail(positions, { w: 313, h: 173, color: color ?? 0xf27a3a });
    const small = renderThumbnail(positions, { w: 16, h: 16, color: color ?? 0xf27a3a });
    const text = [r.header, thumbnailBlock(small, 16, 16), '', thumbnailBlock(thumb, 313, 173), '', r.body].join('\n');
    const img = new Image();
    img.src = thumb;
    return {
      kind: 'gcode',
      name,
      size: text.length,
      text,
      meta: r.meta,
      thumbImg: img,
      printable: true,
      source: 'slicer'
    };
  }
}
