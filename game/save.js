import * as std from 'std';
const DIR = 'mc0:/GRAVITYGUY',
  FILE = DIR + '/save.json';

export function createSaveStore(enabled = true) {
  let job = null,
    queued = null,
    available = false;
  const data = { version: 1, checkpoint: null, score: 0, best: 0, music: true, sfx: true };

  if (enabled)
    try {
      available = MemoryCard.getInfo(0).connected;

      if (available && MemoryCard.exists(FILE)) {
        const saved = MemoryCard.readJSON(FILE);

        if (saved && saved.version === 1) {
          for (const k of ['music', 'sfx']) if (typeof saved[k] === 'boolean') data[k] = saved[k];
          for (const k of ['score', 'best'])
            if (Number.isFinite(saved[k]) && saved[k] >= 0) data[k] = Math.floor(saved[k]);
          const c = saved.checkpoint;

          if (
            c &&
            Number.isFinite(c.x) &&
            c.x >= 274 &&
            c.x < 123090 &&
            Number.isFinite(c.y) &&
            c.y >= -40 &&
            c.y < 501 &&
            Number.isInteger(c.index) &&
            c.index >= 0 &&
            c.index < 1000
          )
            data.checkpoint = { x: c.x, y: c.y, index: c.index, speed: 220 };
        }
      }
    } catch (e) {
      console.log('GG_SAVE_LOAD ' + e);
    }

  function write(snapshot) {
    if (!enabled) return;

    try {
      available = MemoryCard.getInfo(0).connected;
      if (!available) return;
      if (!MemoryCard.exists(DIR)) MemoryCard.mkdir(DIR);

      if (!MemoryCard.exists(DIR + '/icon.sys')) {
        const f = std.open('assets/save/icon.ico', 'rb');
        if (f) {
          f.seek(0, std.SEEK_END);
          const b = new ArrayBuffer(f.tell());
          f.seek(0, std.SEEK_SET);
          f.read(b, 0, b.byteLength);
          f.close();
          MemoryCard.writeFile(DIR + '/icon.ico', b);
          MemoryCard.writeFile(
            DIR + '/icon.sys',
            MemoryCard.createIconSys({ title: 'GRAVITY GUY\nCAMPAIGN', icon: 'icon.ico' })
          );
        }
      }

      job = MemoryCard.writeJSONAsync(FILE, snapshot, { atomic: true });
    } catch (e) {
      console.log('GG_SAVE_ERROR ' + e);
      job = null;
    }
  }

  return {
    data,
    get available() {
      return available;
    },
    save() {
      const snapshot = JSON.parse(JSON.stringify(data));
      if (job) queued = snapshot;
      else write(snapshot);
    },
    poll() {
      if (!job) return;
      try {
        const s = MemoryCard.poll(job);
        if (s.state === 'running') return;
        console.log('GG_SAVE ' + s.state);
        job = null;
        if (queued) {
          const q = queued;
          queued = null;
          write(q);
        }
      } catch (e) {
        job = null;
        console.log('GG_SAVE_ERROR ' + e);
      }
    },
  };
}
