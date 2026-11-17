export const campaign={
  "id": "campaign",
  "name": "Gravity Guy",
  "start": {"x":274,"y":270,"speed":220},
  "width": 123090,
  "height": 501,
  "finishX": 123000,
  "backgroundSections": [6029,6490,21927,22559,47129,48603,60512,62347,71022,71168,77227,77776,87799,88637],
  "chunks": [
    {"id":"sp1","offset":0},
    {"id":"sp2","offset":28288},
    {"id":"sp3","offset":53754},
    {"id":"sp4","offset":81430},
    {"id":"sp5","offset":107406}
  ],
  "path": "assets/levels/campaign.json"
};
export const multiplayer=[
  {
    "id": "mp02",
    "source": "reference/export/148_com.miniclip.GSwitch.PlayState_mp02plist.bin",
    "sha256": "c26e23a97cd3a21adffeebf3eb57e71403a7369355ad8e3bede7b221a4819b79",
    "offset": 0,
    "name": "Track 1",
    "start": {"x":316,"y":103,"speed":211.6983},
    "spawns": [
      {"x":316,"y":103,"gravity":1},
      {"x":316,"y":325,"gravity":-1},
      {"x":316,"y":240,"gravity":1},
      {"x":316,"y":188,"gravity":-1}
    ],
    "width": 16014,
    "height": 501,
    "backgroundSections": [],
    "path": "assets/levels/mp02.json"
  },
  {
    "id": "mp03",
    "source": "reference/export/298_com.miniclip.GSwitch.PlayState_mp03plist.bin",
    "sha256": "8161f530a2f5b2f8f1b6f4e6852654f18b0b6a881f56423ff11f448ed210ba08",
    "offset": 0,
    "name": "Track 2",
    "start": {"x":316,"y":103,"speed":211.6983},
    "spawns": [
      {"x":316,"y":103,"gravity":1},
      {"x":316,"y":325,"gravity":-1},
      {"x":316,"y":240,"gravity":1},
      {"x":316,"y":188,"gravity":-1}
    ],
    "width": 16898,
    "height": 501,
    "backgroundSections": [],
    "path": "assets/levels/mp03.json"
  },
  {
    "id": "mp04",
    "source": "reference/export/191_com.miniclip.GSwitch.PlayState_mp04plist.bin",
    "sha256": "692ac55c5174342a4bced042ed866ff511410765ff1a6123a69c79be26b2090a",
    "offset": 0,
    "name": "Track 3",
    "start": {"x":316,"y":103,"speed":211.6983},
    "spawns": [
      {"x":316,"y":103,"gravity":1},
      {"x":316,"y":325,"gravity":-1},
      {"x":316,"y":240,"gravity":1},
      {"x":316,"y":188,"gravity":-1}
    ],
    "width": 16932,
    "height": 501,
    "backgroundSections": [],
    "path": "assets/levels/mp04.json"
  }
];
export const LEVELS=[campaign,...multiplayer];
export const CAMPAIGN=campaign;
export const MULTIPLAYER=multiplayer;

export function decodeLevel(raw) {
  if (raw.version !== 1) throw new Error('Unsupported level format ' + raw.version);
  const level = raw.meta,
    names = raw.images;
  level.objects = raw.objects;

  for (let i = 0; i < level.objects.length; i++) {
    const a = level.objects[i];
    if (!Array.isArray(a)) continue;
    const o = { x: a[0], y: a[1], w: 34, h: 34, type: a[2], visible: false };
    if (a[3] != null) o.speed = a[3];
    if (a[4] != null) o.spawnX = a[4];
    if (a[5] != null) o.spawnY = a[5];
    level.objects[i] = o;
  }

  level.checkpoints = raw.checkpoints;

  for (const layer of ['decorations', 'foreground']) {
    level[layer] = raw[layer];

    for (let i = 0; i < level[layer].length; i++) {
      const a = level[layer][i];
      level[layer][i] = {
        image: names[a[0]],
        x: a[1],
        y: a[2],
        w: a[3],
        h: a[4],
        sx: a[5],
        sy: a[6],
        renderDepth: a[7],
        depth: a[8],
      };
    }
  }

  return level;
}
