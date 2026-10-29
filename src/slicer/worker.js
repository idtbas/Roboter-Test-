import { sliceMesh } from './slicer.js';

// Slicing runs off the main thread so the 3D view stays smooth.
self.onmessage = (e) => {
  const { id, positions, settings } = e.data;
  try {
    let last = 0;
    const result = sliceMesh(positions, settings, (p, stage) => {
      if (p - last > 0.02 || p === 1) {
        last = p;
        self.postMessage({ id, progress: p, stage });
      }
    });
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
