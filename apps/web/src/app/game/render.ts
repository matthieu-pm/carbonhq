import { STAGES, VIEW_HEIGHT, WIDTH, type AgentId, type Game } from "./engine";

type Pen = (color: string, x: number, y: number, w: number, h?: number) => void;

const INK = "#111b26";
const EDGE = "#f1d4a2";
const SHADE = "#40505a";
const ACCENT = "#ffb458";
const operation: Record<AgentId, string> = { codex: "REPAIR", claude: "HOLD", pi: "VENT", fx: "POWER" };
const palette = {
  codex: { light: "#9ae7ce", mid: "#429b90", dark: "#22585d" },
  claude: { light: "#ffc496", mid: "#d77a51", dark: "#864833" },
  pi: { light: "#efe5ae", mid: "#ceae52", dark: "#786237" },
  fx: { light: "#c4c5fe", mid: "#8a8ed6", dark: "#544c91" },
} satisfies Record<AgentId, { light: string; mid: string; dark: string }>;

const glyphs: Record<string, number[]> = {
  "0": [7, 5, 5, 5, 7], "1": [2, 6, 2, 2, 7], "2": [7, 1, 7, 4, 7],
  "3": [7, 1, 7, 1, 7], "4": [5, 5, 7, 1, 1], "5": [7, 4, 7, 1, 7],
  "6": [7, 4, 7, 5, 7], "7": [7, 1, 2, 2, 2], "8": [7, 5, 7, 5, 7],
  "9": [7, 5, 7, 1, 7], A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6],
  C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7],
  F: [7, 4, 6, 4, 4], G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5],
  I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2], K: [5, 5, 6, 5, 5],
  L: [4, 4, 4, 4, 7], M: [5, 7, 7, 5, 5], N: [5, 7, 7, 7, 5],
  O: [2, 5, 5, 5, 2], P: [6, 5, 6, 4, 4], Q: [2, 5, 5, 7, 3],
  R: [6, 5, 6, 5, 5], S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2],
  U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5],
  X: [5, 5, 2, 5, 5], Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7],
  "-": [0, 0, 7, 0, 0], "/": [1, 1, 2, 4, 4],
};

function letter(p: Pen, message: string, color: string, x: number, y: number, scale = 1) {
  for (const character of message) {
    glyphs[character]?.forEach((mask, row) => {
      for (let col = 0; col < 3; col++) {
        if (mask & (4 >> col)) p(color, x + col * scale, y + row * scale, scale, scale);
      }
    });
    x += scale * 4;
  }
}

function noise(seed: number) {
  return ((Math.imul(seed ^ (seed >>> 13), 1597334677) >>> 0) % 65536) / 65536;
}

function dot(p: Pen, color: string, x: number, y: number, radius: number) {
  for (let row = -radius; row <= radius; row++) {
    const half = Math.floor(Math.sqrt(radius * radius - row * row));
    p(color, x - half, y + row, half * 2 + 1);
  }
}

function sky(ctx: CanvasRenderingContext2D, p: Pen, cameraX: number, cameraY: number, width: number, height: number, stage: number, frame: number) {
  const horizon = Math.round(height * .65 + Math.min(100, cameraY * .15));
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#2c3a51");
  gradient.addColorStop(.26, "#54485a");
  gradient.addColorStop(.56, "#9d605d");
  gradient.addColorStop(.77, "#d88963");
  gradient.addColorStop(1, "#e6a76d");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const parallax = (factor: number) => width >= WIDTH ? -cameraX : -cameraX * factor;
  const sunX = Math.round(358 + parallax(.64));
  const sunY = Math.round(horizon - 82);
  dot(p, "#eaae7c", sunX, sunY, 56);
  dot(p, "#f3bd83", sunX, sunY + 2, 51);
  for (let offset = 0; offset < 29; offset += 4) {
    const y = 20 + offset;
    const half = Math.floor(Math.sqrt(51 * 51 - y * y));
    p("#d59675", sunX - half, sunY + y, half * 2, offset >= 16 ? 2 : 1);
  }

  for (let n = 0; n < Math.ceil(width / 19); n++) {
    const x = Math.round((noise(n * 727 + 8) * (width + 240) + Math.floor(frame / 90)) % (width + 240) - 120 - Math.max(0, cameraX) * .28);
    const y = Math.round(horizon - 224 + noise(n * 897 + 4) * 193);
    const w = 11 + Math.floor(noise(n * 233 + 9) * 82);
    const c = n % 3 === 0 ? "#805c67" : "#996b6c";
    p(c, x, y, w, 2);
    p(c, x + 4, y - 2, Math.round(w * .71), 2);
    p("#b67c72", x + 3, y + 2, Math.round(w * .76));
    if (n % 4 === 0) p("#be8574", x + 8, y + 7, Math.round(w * .4));
  }

  for (let layer = 0; layer < 3; layer++) {
    const colors = ["#947077", "#635765", "#343f50"];
    const window = ["#af8080", "#99766d", "#a7816b"][layer];
    const stride = [17, 23, 30][layer];
    const base = horizon + layer * 39 + (cameraY * (.05 + layer * .09));
    const offset = parallax(.18 + layer * .24);
    const first = Math.floor(-offset / stride) - 2;
    const last = Math.ceil((width - offset) / stride) + 1;
    for (let i = first; i <= last; i++) {
      const seed = (i + 25) * (59 + layer * 131);
      const x = Math.round(i * stride + offset);
      const h = 21 + Math.round(noise(seed + 5) * (42 + layer * 19));
      const w = stride - 2 + Math.floor(noise(seed + 2) * 6);
      const y = Math.round(base - h);
      const c = colors[layer];
      p(c, x, y, w, height - y);
      p(c, x + 2, y - 4, w - 7, 4);
      if (i % 3 === 1) p(c, x + w - 6, y - 14, 2, 14);
      if (i % 7 === 2) {
        p(c, x + 3, y - 23, 3, 23);
        p(c, x - 3, y - 19, 14, 1);
        p(frame % 90 < 48 ? "#fa9d69" : "#a55e60", x + 3, y - 24, 2, 2);
      }
      for (let row = y + 6; row < Math.min(height, y + h + 13); row += 9) {
        for (let col = x + 3; col < x + w - 3; col += 5) {
          if (noise(seed * row + col) > .55) p(window, col, row, 1 + layer % 2, 2);
        }
      }
      if (layer === 2) {
        p("#505061", x + 2, y + 3, 1, h + 45);
        p("#3f4759", x + w - 4, y + 3, 2, h + 41);
      }
    }
  }

  if (stage !== 3) {
    const offset = parallax(.54);
    const first = Math.floor(-offset / 110) - 1;
    const last = Math.ceil((width - offset) / 110) + 1;
    for (let i = first; i <= last; i++) {
      const x = Math.round(i * 110 - 60 + offset);
      const y = Math.round(horizon + 20 + cameraY * .18);
      p("#4a464f", x, y - 78, 6, 170);
      p("#4a464f", x - 10, y - 78, 30, 3);
      p("#725764", x + 1, y - 74, 1, 116);
      for (let col = 12; col < 103; col += 2) {
        const sag = Math.round(Math.sin(col / 110 * Math.PI) * 14);
        p("#554958", x + col, y - 72 + sag, 2);
        p("#554958", x + col, y - 66 + sag, 2);
      }
    }
  }

  for (let i = 0; i < 30; i++) {
    const start = noise(i * 82 + 22) * width;
    const x = Math.round((start + frame / (11 + i % 15)) % width);
    const y = Math.round((noise(i * 510 + 9) * height + cameraY * .14) % height);
    p(i % 5 ? "#c0927e" : "#f3bd89", x, y, i % 5 ? 1 : 2);
  }
}

function borderingTowers(p: Pen, cameraX: number, cameraY: number, width: number, height: number, frame: number) {
  if (width <= WIDTH) return;

  for (const side of [-1, 1]) {
    const origin = side === -1 ? 0 : WIDTH;
    const space = side === -1 ? -cameraX : cameraX + width - WIDTH;
    for (let index = 0; index * 165 < space; index++) {
      const off = index * 165;
      const towerWidth = 84 + Math.round(noise(index * 57 + side * 27) * 48);
      const x = side === -1 ? origin - 95 - towerWidth - off : origin + 101 + off;
      const roof = Math.round(cameraY * .68 + height * (.62 + index % 2 * .11));
      const tall = cameraY + height - roof;
      p("#253340", x, roof, towerWidth, tall);
      p("#3b4550", x + 4, roof + 6, towerWidth - 8, tall);
      p("#303c49", x + towerWidth - 24, roof + 3, 22, tall);
      p("#62606a", x, roof, towerWidth, 2);
      p("#384651", x + 8, roof - 10, 41, 10);
      p("#4d515b", x + 8, roof - 10, 41, 2);
      p("#34454e", x + 59, roof - 26, 11, 26);
      p("#736a69", x + 61, roof - 28, 7, 2);
      antenna(p, x + towerWidth - 28, roof, frame + index * 21, 54 + index % 2 * 23);
      for (let row = roof + 12; row < cameraY + height; row += 16) {
        p("#293846", x + 5, row + 10, towerWidth - 10, 2);
        for (let col = x + 9; col < x + towerWidth - 10; col += 12) {
          const lit = noise(row * 559 + col * 101) > .75;
          p("#273640", col, row, 6, 6);
          if (lit) {
            p("#997469", col + 1, row + 1, 4, 4);
            p("#bd8d73", col + 1, row + 1, 4);
          }
        }
      }
    }
  }
}

function beam(p: Pen, x: number, y: number, w: number, h: number, iron: string) {
  p(INK, x - 2, y, w + 4, h);
  p(iron, x, y, w, h);
  p("#677079", x + 1, y + 1, 1, h - 1);
  p("#282a32", x + w - 3, y + 1, 2, h - 1);
  for (let n = 9; n < h; n += 24) {
    p("#21252c", x, y + n, w, 4);
    p("#888478", x + 2, y + n + 1, 1);
    p("#888478", x + w - 4, y + n + 1, 1);
  }
}

function machine(p: Pen, x: number, y: number, accent: string, frame: number) {
  p("#171e25", x + 4, y - 63, 55, 63);
  p("#3d4950", x + 6, y - 61, 51, 59);
  p("#576364", x + 7, y - 60, 48, 2);
  p("#222930", x + 41, y - 58, 14, 54);
  p("#63807a", x + 11, y - 53, 26, 19);
  p("#203035", x + 12, y - 52, 24, 17);
  p("#315056", x + 14, y - 50, 20, 12);
  for (let n = 0; n < 7; n++) {
    const h = 2 + Math.round(noise(Math.floor(frame / 20) + n * 162) * 6);
    p(accent, x + 15 + n * 2, y - 40 - h, 1, h);
  }
  for (let n = 0; n < 5; n++) {
    p("#182127", x + 12, y - 27 + n * 4, 27, 2);
    p("#606b69", x + 12, y - 25 + n * 4, 27);
  }
  p(accent, x + 45, y - 53, 4, 2);
  p("#9c5d50", x + 45, y - 46, 4, 2);
  p("#7b7e6e", x + 45, y - 39, 4, 2);
  p("#858473", x + 6, y - 4, 52, 2);
  p("#222a32", x, y - 8, 8, 8);
  p("#222a32", x + 52, y - 8, 11, 8);
}

function tank(p: Pen, x: number, y: number, color: string) {
  p("#19242a", x + 5, y - 68, 29, 62);
  p("#19242a", x + 1, y - 63, 37, 52);
  p(color, x + 3, y - 62, 33, 50);
  p(color, x + 7, y - 66, 25, 57);
  p("#647877", x + 9, y - 63, 5, 48);
  p("#566968", x + 15, y - 63, 4, 49);
  p("#26353d", x + 27, y - 63, 7, 49);
  p("#858e83", x + 8, y - 55, 25, 2);
  p("#242e37", x + 4, y - 52, 31, 3);
  p("#6e7d78", x + 4, y - 51, 31);
  p("#242e37", x + 4, y - 22, 31, 3);
  p("#6e7d78", x + 4, y - 20, 31);
  p("#26323a", x + 7, y - 10, 7, 10);
  p("#26323a", x + 26, y - 10, 7, 10);
  p("#545a5b", x + 14, y - 72, 10, 5);
}

function antenna(p: Pen, x: number, y: number, frame: number, tall = 111) {
  const top = y - tall;
  p("#242d3c", x - 2, top, 4, tall);
  p("#787276", x - 1, top + 2, 1, tall - 2);
  for (let n = 0; n < 5; n++) {
    const span = 10 + n * 7;
    const rail = top + 17 + n * 11;
    p("#252c3b", x - span / 2, rail, span, 3);
    p("#817673", x - span / 2 + 2, rail, span - 4);
    p("#252c3b", x - span / 2, rail - 4, 2, 4);
    p("#252c3b", x + span / 2 - 2, rail - 4, 2, 4);
  }
  for (let n = 0; n < tall - 36; n += 2) {
    const spread = n * .14;
    p("#343849", x - spread, top + 36 + n, 2, 2);
    p("#343849", x + spread, top + 36 + n, 2, 2);
    if (n % 12 === 0) p("#494755", x - spread, top + 36 + n, spread * 2);
  }
  p("#4d4d55", x - 17, y - 5, 34, 5);
  if (frame % 100 < 58) {
    p("#a85555", x - 4, top - 3, 8, 6);
    p("#f49372", x - 2, top - 2, 4, 4);
    p("#ffd6a5", x - 1, top - 1, 2, 2);
  }
}

function backdrop(p: Pen, game: Game, cameraY: number, height: number) {
  const stage = game.stageIndex;
  const wall = ["#554249", "#37404a", "#36494b", "#41424e"][stage];
  const mortar = ["#493943", "#2d3640", "#2b3d45", "#353744"][stage];
  const stone = ["#61494c", "#43505a", "#425558", "#4a4957"][stage];
  const metal = ["#5d5156", "#4c5861", "#526367", "#535362"][stage];
  const panes = stage === 3 ? [[28, 43], [381, 71]] : [[24, 64], [214, 52], [407, 55]];

  for (let row = Math.max(0, Math.floor((cameraY - 72) / 145)); row < Math.ceil((cameraY + height + 150) / 145); row++) {
    const floor = row * 145;
    for (const [x, w] of panes) {
      p(mortar, x - 2, floor, w + 4, 146);
      for (let n = 0; n < 13; n++) {
        const y = floor + n * 11;
        p(n % 4 === 1 ? stone : wall, x, y, w, 10);
        for (let col = x - 15 + n % 2 * 15; col < x + w - 2; col += 29) {
          if (col >= x) p(mortar, col, y, 1, 10);
          const inset = Math.max(col + 3, x + 1);
          p(stone, inset, y + 2, Math.max(0, Math.min(17, x + w - inset - 2)));
        }
      }
      beam(p, x, floor, 7, 145, metal);
      beam(p, x + w - 7, floor, 7, 145, metal);
    }

    if (stage !== 3) {
      const cableY = floor + 27;
      for (let col = 81; col <= 407; col += 2) {
        const sag = Math.round(Math.sin((col - 81) / 326 * Math.PI) * 28);
        p("#2a2833", col, cableY + sag, 2, 2);
        p("#35303a", col, cableY + sag + 6, 2);
      }
      p("#262a33", 77, cableY - 2, 10, 12);
      p("#262a33", 401, cableY - 2, 10, 12);
      p("#aa8271", 81, cableY, 1, 7);
      p("#aa8271", 405, cableY, 1, 7);
    }
    if (stage === 0) {
      const x = row % 2 ? 318 : 104;
      const shelfX = row % 2 ? x - 3 : 86;
      const shelfWidth = row % 2 ? 91 : x + 58 - shelfX;
      p("#37333b", shelfX, floor + 124, shelfWidth, 5);
      p("#746467", shelfX, floor + 124, shelfWidth);
      for (let n = 0; n < 13; n++) {
        const support = row % 2 ? shelfX + shelfWidth - n - 16 : shelfX + 6 + n;
        p("#3d3940", support, floor + 128 + n, 3, 2);
      }
      p("#2b2d37", x, floor + 77, 53, 48);
      p("#695358", x + 2, floor + 79, 49, 44);
      p("#857069", x + 2, floor + 79, 49, 2);
      p("#423841", x + 5, floor + 84, 43, 35);
      for (let n = 0; n < 8; n++) p(n % 2 ? "#59464a" : "#544449", x + 7 + n * 5, floor + 85, 3, 32);
      p("#bb8a68", x + 18, floor + 97, 16, 5);
      p("#57504d", x + 20, floor + 99, 11);
    } else if (stage === 1) {
      const x = row % 2 ? 74 : 285;
      const shelfX = row % 2 ? x : 264;
      p("#313841", shelfX, floor + 127, x + 64 - shelfX, 6);
      p("#727470", shelfX, floor + 127, x + 64 - shelfX);
      machine(p, x, floor + 127, "#789981", game.frame);
    } else if (stage === 2) {
      const x = row % 2 ? 315 : 99;
      const shelfX = row % 2 ? x - 3 : 86;
      p("#293842", shelfX, floor + 124, x + 79 - shelfX, 5);
      p("#617574", shelfX, floor + 124, x + 79 - shelfX, 1);
      tank(p, x, floor + 124, "#4c6265");
      tank(p, x + 37, floor + 124, "#475b62");
      p("#7c8074", x + 11, floor + 47, 50, 3);
      p("#3a4952", x + 13, floor + 49, 48, 2);
    } else {
      antenna(p, row % 2 ? 343 : 102, floor + 127, game.frame, 94 + row % 2 * 18);
    }
  }
}

function platform(p: Pen, surface: Game["platforms"][number]) {
  const { x, y, w, h, kind } = surface;
  const movable = kind === "lift" || kind === "shuttle";
  const color = kind === "bridge" ? "#42796f" : kind === "shuttle" ? "#7778a9" : "#5d676c";
  if (kind === "floor") {
    p("#26333c", x - 7, y + 14, w + 14, VIEW_HEIGHT / 2);
    p("#1a2531", x + 4, y + 21, w - 8, VIEW_HEIGHT / 2);
    for (let row = 25; row < VIEW_HEIGHT / 2; row += 23) {
      p("#556366", x + 8, y + row, w - 16, 2);
      for (let n = 8; n < w - 8; n += 28) {
        p("#2e4650", x + n, y + row + 4, 19, 8);
        p("#273c46", x + n, y + row + 11, 19);
      }
    }
  } else if (!movable && kind !== "bridge") {
    for (let n = 0; n < 24; n++) {
      p("#2b333d", x + 7 + n, y + 11 + n, 3, 2);
      p("#2b333d", x + w - 10 - n, y + 11 + n, 3, 2);
    }
    p("#4b4d54", x + 30, y + 34, w - 60, 2);
  }
  p(INK, x - 2, y + 2, w + 4, h);
  p(color, x, y + 3, w, h - 4);
  p("#303b42", x + 1, y + h - 3, w - 2, 2);
  p("#958679", x, y + 2, w, 2);
  p(EDGE, x, y, w, 2);
  p("#fff0c1", x + 3, y, Math.min(w - 6, 24), 1);
  for (let col = 7; col < w - 5; col += 12) {
    p("#26333c", x + col, y + 6, 7, 3);
    p("#82908a", x + col, y + 9, 7);
  }
  for (const bolt of [x + 2, x + w - 4]) {
    p("#29393e", bolt, y + 5, 2, 4);
    p(movable ? ACCENT : "#aab1a0", bolt, y + 5, 2);
  }
  if (kind === "floor") {
    p("#18222b", x, y + 13, w, 5);
    for (let col = 4; col < w - 6; col += 9) {
      for (let row = 0; row < 4; row++) p("#a7855f", x + col + row, y + 14 + row, 3);
    }
  }
}

function mechanismBackdrop(p: Pen, duty: Game["duties"][number], home: Game["platforms"][number]) {
  const { destination, active, complete, agent } = duty;
  const { x, y, w } = home;
  if (agent === "pi") {
    const ventLeft = x + w / 2 - 20;
    p("#1a242c", ventLeft, y - 29, 40, 29);
    p("#74807c", ventLeft + 2, y - 26, 36, 3);
    p("#3a5255", ventLeft + 2, y - 23, 3, 21);
    p("#3a5255", ventLeft + 35, y - 23, 3, 21);
    for (let n = 0; n < 4; n++) p("#52686a", ventLeft + 7, y - 19 + n * 4, 26, 1);
    return;
  }
  if (agent === "claude" || agent === "fx") {
    const railY = agent === "claude" ? destination.y + 12 : y;
    const railBottom = agent === "claude" ? duty.y + 15 : y + 12;
    const railLeft = agent === "claude" ? x + 5 : Math.min(x, destination.x);
    const railRight = agent === "claude" ? x + w - 7 : Math.max(x + w, destination.x + destination.w);
    if (agent === "claude") {
      for (const col of [railLeft, railRight]) {
        p("#28313a", col, railY, 5, railBottom - railY);
        p("#8b786a", col + 1, railY + 1, 1, railBottom - railY - 1);
      }
      for (let n = railY + 3; n < railBottom; n += 10) {
        p("#39454a", railLeft + 6, n, railRight - railLeft - 6);
      }
    } else {
      const start = x + w / 2;
      const end = destination.x + destination.w / 2;
      const endY = destination.y + 49;
      const segments = Math.max(1, Math.ceil(Math.abs(end - start) / 3));
      for (let n = 0; n <= segments; n++) {
        const progress = n / segments;
        const railX = start + (end - start) * progress;
        const railY = railBottom + (endY - railBottom) * progress;
        p("#333749", railX, railY, 3, 5);
        p("#8a7893", railX, railY + 1, 3);
      }
    }
  }
  if (!active && !complete && agent !== "fx") {
    const ghost = palette[agent].dark;
    for (const end of [x, x + w - 13]) {
      p("#17222e", end, y + 2, 13, 9);
      p(ghost, end + 1, y + 1, 11, 2);
      p("#91816c", end + 2, y + 5, 3, 3);
    }
    if (agent === "codex") {
      for (let col = x + 13; col < x + w - 17; col += 7) p(ghost, col, y + 8, 3);
    }
  }
}

function hazard(p: Pen, danger: Game["hazards"][number], frame: number) {
  const { x, y, w, h, kind, active } = danger;
  if (kind === "spikes") {
    p("#2b262e", x, y + h - 3, w, 3);
    for (let n = 0; n < w - 6; n += 9) {
      for (let row = 0; row < h - 3; row++) {
        const half = Math.floor(row / 3);
        p("#b76860", x + n + 4 - half, y + row, half * 2 + 1);
        p("#f7a581", x + n + 4 - half, y + row, 1);
      }
    }
    return;
  }

  const centerX = x + w / 2;
  const centerY = y + h / 2;
  dot(p, "#1c2731", centerX, centerY, 17);
  dot(p, active ? "#ba735d" : "#71817a", centerX, centerY, 15);
  dot(p, "#273a46", centerX, centerY, 13);
  for (let blade = 0; blade < 4; blade++) {
    const angle = (active ? frame / 3.4 : .6) + blade * Math.PI / 2;
    for (let radius = 3; radius < 12; radius++) {
      p(active ? "#dc9b77" : "#6a7c79", centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius, 3, 3);
    }
  }
  dot(p, active ? "#ffe4b0" : "#889681", centerX, centerY, 3);
  if (active) {
    for (let n = 0; n < 12; n++) {
      const pos = (n * 19 + frame * (2 + n % 2)) % (w - 8);
      const flowY = y + 4 + (n * 11) % (h - 8);
      p(n % 2 ? "#e1a166" : "#ffd19a", x + pos, flowY, 4 + n % 6);
    }
  }
}

function station(p: Pen, duty: Game["duties"][number], frame: number) {
  const { x, y, agent, active, complete, workX, workY } = duty;
  const { light, mid, dark } = palette[agent];
  const side = x < WIDTH / 2 ? -1 : 1;
  const column = x + side * 29 - 8;
  p(INK, column + 2, y - 23, 12, 23);
  p("#626c68", column + 4, y - 20, 8, 20);
  p("#283940", column + 9, y - 18, 3, 18);
  p(INK, column - 1, y - 27, 18, 12);
  p(dark, column, y - 26, 16, 10);
  p(mid, column + 1, y - 25, 14, 2);
  p("#202d31", column + 2, y - 22, 12, 5);
  p(active || complete || frame % 90 < 37 ? light : mid, column + 3, y - 21, 6, 2);
  p(complete ? "#99bc8c" : "#e8a574", column + 11, y - 21, 2, 2);
  p("#313c42", column - 2, y - 4, 20, 4);
  if (active) {
    const work = operation[agent];
    const width = work.length * 4 + 9;
    p(INK, workX - width / 2, workY - 46, width, 12);
    p(dark, workX - width / 2, workY - 35, width);
    letter(p, work, light, workX - width / 2 + 5, workY - 42);
    for (let n = 0; n < 5; n++) {
      const phase = (frame * (1 + n % 2) + n * 4) % 17;
      const sparkX = workX + (n - 2) * (3 + phase / 5);
      p(n % 3 ? mid : light, sparkX, workY - 7 - phase, n % 2 + 1, 2);
    }
  }
}

function door(p: Pen, exit: Game["exit"], stage: number, frame: number) {
  const { x, y, w, h, ready } = exit;
  const lamp = ready ? "#a6e1aa" : "#ef9c69";
  const center = x + w / 2;
  p("#252934", x - 5, y - 4, w + 10, h + 4);
  p("#6c6663", x - 3, y - 3, w + 6, 7);
  p("#9d8977", x, y - 4, w, 2);
  p("#706d63", x - 3, y + 3, 5, h - 3);
  p("#514d50", x + w - 3, y + 3, 7, h - 3);
  p("#18232d", x + 2, y + 7, w - 4, h - 7);
  if (ready) {
    const entrance = stage === 3 ? "#43887f" : "#3f655d";
    p(entrance, x + 6, y + 9, w - 12, h - 9);
    p("#1d3841", x + 9, y + 10, w - 18, h - 10);
    p("#b6cf9f", x + 5, y + 10, 1, h - 11);
    p("#749884", x + w - 7, y + 10, 1, h - 10);
    for (let n = 0; n < 3; n++) p("#77988a", x + 5 - n * 2, y + h - 1 + n, w - 10 + n * 4);
  } else {
    p("#555f5e", x + 4, y + 9, w - 8, h - 10);
    for (let n = 0; n < h - 13; n += 5) {
      p("#394750", x + 4, y + 10 + n, w - 8, 2);
      p("#777869", x + 5, y + 13 + n, w - 10);
    }
    p("#303a40", center - 1, y + 8, 2, h - 9);
  }
  p("#292e36", center - 10, y - 12, 20, 9);
  letter(p, "EXIT", lamp, center - 7, y - 10);
  p(ready || frame % 100 < 57 ? lamp : "#785954", x + w - 2, y + 7, 3, 4);
}

function operator(p: Pen, player: Game["player"], frame: number) {
  const foot = player.y + player.h;
  const center = Math.round(player.x + player.w / 2);
  const mirror: Pen = (color, x, y, w, h) => {
    p(color, player.facing === 1 ? center + x : center - x - w, foot + y, w, h);
  };
  const s = mirror;
  const step = Math.abs(player.vx) > .5 ? Math.floor(frame / 4) % 4 : 0;
  const bob = step % 2;
  const air = Math.abs(player.vy) > .6;
  const frontLeg = air ? 3 : [0, 2, 1, -1][step];
  const backLeg = air ? -2 : [0, -2, -1, 1][step];
  if (!air) p("#353941", center - 11, foot + 3, 23, 2);

  s(INK, -6 + backLeg, -10, 5, air ? 7 : 10);
  s("#485763", -5 + backLeg, -9, 3, air ? 4 : 7);
  s(INK, -6 + backLeg, air ? -4 : -3, 8, 3);
  s("#9c8068", -5 + backLeg, air ? -3 : -2, 6, 1);
  s(INK, 2 + frontLeg, -10, 5, 10);
  s("#60717a", 3 + frontLeg, -9, 3, 6);
  s(INK, 1 + frontLeg, -3, 9, 3);
  s("#d0ae87", 3 + frontLeg, -2, 6, 1);
  s(INK, -9, -24 + bob, 17, 15);
  s("#262b32", -7, -22 + bob, 13, 12);
  s("#454b50", -7, -21 + bob, 3, 9);
  s("#111922", -2, -21 + bob, 8, 11);
  s("#a49e8d", 2, -20 + bob, 1, 8);
  s("#e4dfcf", -6, -20 + bob, 2, 3);
  s("#e4dfcf", -4, -19 + bob, 2, 2);
  s("#e4dfcf", -2, -18 + bob, 2, 3);
  s("#737f7d", -6, -10, 12, 1);
  const hand = air ? 3 : step % 3 - 1;
  s(INK, 6 + hand, -22 + bob, 4, 10);
  s("#3a4651", 7 + hand, -21 + bob, 2, 7);
  s("#d58d61", 7 + hand, -14 + bob, 3, 3);
  s(INK, -7, -34 + bob, 13, 13);
  s(INK, -9, -31 + bob, 17, 6);
  s("#4b3434", -6, -33 + bob, 12, 6);
  s("#775147", -5, -33 + bob, 7, 2);
  s("#261f2b", -7, -30 + bob, 7, 4);
  s("#e3a271", -2, -28 + bob, 8, 7);
  s("#f6bf89", 2, -28 + bob, 4, 3);
  s("#f6bf89", 6, -26 + bob, 2, 3);
  s("#352a32", 4, -28 + bob, 1, 2);
  s("#b56c55", -4, -27 + bob, 3, 4);
  s("#934f43", 1, -22 + bob, 5, 1);
}

function bot(p: Pen, id: AgentId, x: number, y: number, step: number, working = false) {
  const { light, mid, dark } = palette[id];
  const blink = step % 117 >= 111;
  const bounce = step % 24 < 12 ? 0 : 1;
  const b: Pen = (color, offX, offY, w, h) => p(color, x + offX, y + offY + bounce, w, h);
  const eye = blink ? dark : light;

  if (id === "codex") {
    b(INK, -13, -23, 26, 20);
    b(INK, -10, -26, 20, 5);
    b(mid, -11, -22, 22, 16);
    b(light, -9, -25, 18, 3);
    b(dark, -10, -9, 20, 4);
    b(INK, -8, -19, 16, 8);
    b("#293f48", -7, -18, 14, 2);
    b(eye, -5, -15, 3, 2);
    b(eye, 2, -15, 3, 2);
    b(light, -11, -21, 1, 11);
    b(mid, -15, -16, 3, 7);
    b(mid, 12, working ? -17 : -16, working ? 8 : 3, working ? 3 : 7);
    if (working) b(light, 19, -19, 3, 5);
    p(INK, x - 11, y - 5, 22, 5);
    p(dark, x - 9, y - 4, 18, 3);
    for (let n = 0; n < 5; n++) p(mid, x - 8 + n * 4, y - 3 + (n + step) % 2, 2);
  } else if (id === "claude") {
    b(INK, -9, -28, 18, 19);
    b(INK, -7, -32, 14, 6);
    b(mid, -8, -27, 16, 15);
    b(light, -6, -31, 12, 5);
    b("#e59a65", -7, -26, 14, 5);
    b(INK, -7, -24, 14, 6);
    b(eye, -5, -23, 3, 2);
    b(eye, 2, -23, 3, 2);
    b(light, -7, -14, 14, 2);
    b(dark, -9, -11, 18, 4);
    b(INK, -13, -19, 4, 9);
    b(mid, -12, -18, 3, 7);
    b(INK, 8, working ? -27 : -19, 5, 10);
    b(mid, 9, working ? -27 : -18, 3, 8);
    if (working) b(light, 9, -29, 4, 3);
    for (const [n, offset] of [[-8, 0], [3, 1]]) {
      const stride = (step + offset * 5) % 10 < 5 ? 2 : 0;
      p(INK, x + n, y - 8 - stride, 6, 8);
      p(mid, x + n + 1, y - 7 - stride, 4, 4);
      p(light, x + n, y - 2 - stride, 6);
    }
  } else if (id === "pi") {
    b(INK, -8, -21, 16, 18);
    b(INK, -11, -18, 22, 10);
    b(mid, -7, -20, 14, 17);
    b(light, -5, -22, 10, 3);
    b("#e0c276", -10, -17, 20, 8);
    b(INK, -7, -16, 14, 6);
    b(eye, -4, -14, 2, 2);
    b(eye, 2, -14, 2, 2);
    b(dark, -7, -7, 14, 3);
    b(INK, 0, -27, 2, 7);
    b(light, -1, -28, 4, 2);
    for (const n of [-10, 7]) {
      p(INK, x + n, y - 7, 4, 6);
      p(light, x + n + 1, y - 4, 2, 2);
    }
    if (working) b(light, -15, -11, 4);
  } else {
    const hover = step % 19 > 9 ? -2 : 0;
    const t: Pen = (color, offX, offY, w, h) => b(color, offX, offY + hover - 3, w, h);
    t(INK, -12, -21, 24, 12);
    t(INK, -9, -24, 18, 18);
    t(mid, -8, -23, 16, 15);
    t(light, -6, -23, 12, 2);
    t(INK, -6, -20, 12, 7);
    t(eye, -4, -18, 3, 2);
    t(eye, 2, -18, 3, 2);
    t(dark, -10, -13, 20, 3);
    for (const n of [-16, 9]) {
      t(INK, n, -19, 7, 8);
      t(light, n + 1, -18, 5, 2);
      t(mid, n + 2, -15, 3, 3);
      if (working || step % 8 > 3) t("#e4bbf4", n + 3, -10, 1, 2 + step % 3);
    }
    t("#e4bbf4", -2, -5, 4, 2);
    p("#5c5675", x - 6, y - 2, 12);
  }
}

function tag(p: Pen, id: AgentId, x: number, y: number, frame: number) {
  const text = id.toUpperCase();
  const w = text.length * 4 + 10;
  const top = y - 55 + Math.floor(frame / 15) % 2;
  p(INK, x - w / 2, top, w, 13);
  p(palette[id].dark, x - w / 2, top + 12, w);
  letter(p, text, palette[id].light, x - w / 2 + 5, top + 4);
  p(palette[id].light, x - 3, top + 15, 7);
  p(palette[id].light, x - 2, top + 16, 5);
  p(palette[id].light, x - 1, top + 17, 3);
}

export function drawPortrait(canvas: HTMLCanvasElement, id: AgentId) {
  canvas.width = 40;
  canvas.height = 36;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  bot(rectangles(ctx), id, 20, 34, 0);
}

function rectangles(ctx: CanvasRenderingContext2D, cameraX = 0, cameraY = 0): Pen {
  let lastColor = "";
  return (color, x, y, w, h = 1) => {
    if (w <= 0 || h <= 0 || x - cameraX + w < 0 || y - cameraY + h < 0 ||
      x - cameraX > ctx.canvas.width || y - cameraY > ctx.canvas.height) return;
    if (color !== lastColor) {
      ctx.fillStyle = color;
      lastColor = color;
    }
    ctx.fillRect(Math.round(x) - cameraX, Math.round(y) - cameraY, Math.round(w), Math.round(h));
  };
}

const sceneryLayers = new WeakMap<HTMLCanvasElement, { canvas: HTMLCanvasElement; key: string }>();

function scenery(ctx: CanvasRenderingContext2D, game: Game, cameraX: number, cameraY: number) {
  const { canvas } = ctx;
  const { width, height } = canvas;
  const key = [width, height, cameraX, cameraY, game.stageIndex, Math.floor(game.frame / 6)].join("/");
  let layer = sceneryLayers.get(canvas);
  if (!layer) {
    layer = { canvas: canvas.ownerDocument.createElement("canvas"), key: "" };
    sceneryLayers.set(canvas, layer);
  }
  if (layer.key !== key) {
    if (layer.canvas.width !== width) layer.canvas.width = width;
    if (layer.canvas.height !== height) layer.canvas.height = height;
    const layerCtx = layer.canvas.getContext("2d", { alpha: false });
    if (!layerCtx) return;

    sky(layerCtx, rectangles(layerCtx), cameraX, cameraY, width, height, game.stageIndex, game.frame);
    const p = rectangles(layerCtx, cameraX, cameraY);
    borderingTowers(p, cameraX, cameraY, width, height, game.frame);
    backdrop(p, game, cameraY, height);
    layer.key = key;
  }
  ctx.drawImage(layer.canvas, 0, 0);
}

export function drawWorld(canvas: HTMLCanvasElement, game: Game) {
  const height = VIEW_HEIGHT;
  const displayHeight = canvas.clientHeight || height;
  const displayWidth = canvas.clientWidth || WIDTH;
  const width = Math.max(1, Math.round(height * displayWidth / displayHeight));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;

  const stage = STAGES[game.stageIndex];
  const playerCenter = game.player.x + game.player.w / 2;
  const cameraX = width > WIDTH
    ? Math.round((WIDTH - width) / 2)
    : Math.round(Math.min(WIDTH - width, Math.max(0, playerCenter - width / 2)));
  const safeInset = Math.min(height * .32, Math.ceil(72 * height / displayHeight));
  const floor = stage.route.find((surface) => surface.kind === "floor")?.y ?? stage.height - 40;
  const dockView = floor + safeInset - height;
  const headLimit = game.player.y - safeInset - 8;
  const cameraY = Math.round(Math.min(headLimit, Math.max(game.cameraY, Math.min(dockView, game.cameraY + safeInset))));
  const p = rectangles(ctx, cameraX, cameraY);

  scenery(ctx, game, cameraX, cameraY);
  const signX = 189;
  const signY = stage.height - 115;
  p("#282b37", signX, signY, 102, 26);
  p(SHADE, signX + 1, signY + 1, 100, 24);
  p("#27333c", signX + 3, signY + 3, 96, 20);
  p("#8a8375", signX + 4, signY + 4, 2, 2);
  p("#8a8375", signX + 96, signY + 4, 2, 2);
  const name = stage.name.toUpperCase();
  letter(p, name, "#e0b98c", signX + 51 - name.length * 2, signY + 7);
  letter(p, "SECTOR 0" + (game.stageIndex + 1), "#909b97", signX + 33, signY + 15);

  for (const duty of game.duties) {
    const home = stage.duties.find((item) => item.id === duty.id)?.mechanism ?? duty.mechanism;
    mechanismBackdrop(p, duty, home);
  }
  for (const surface of game.platforms) platform(p, surface);
  for (const obstacle of game.hazards) hazard(p, obstacle, game.frame);
  door(p, game.exit, game.stageIndex, game.frame);
  for (const duty of game.duties) station(p, duty, game.frame);

  for (const member of game.crew) {
    const waiting = member.mode === "waiting";
    const working = member.mode === "working";
    const step = waiting ? game.frame % 120 : game.frame;
    bot(p, member.id, Math.round(member.x), Math.round(member.y), step, working);
    if (waiting) tag(p, member.id, member.x, member.y, game.frame);
  }
  operator(p, game.player, game.frame);
}
