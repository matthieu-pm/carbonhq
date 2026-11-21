export const VICTORY_DURATION_MS = 7200;
export const VICTORY_STILL_MS = 4400;
export const VICTORY_SIGNAL_MS = 1840;
export const VICTORY_IGNITION_MS = 2500;

type Point = { x: number; y: number };
type Window = Point & { w: number; h: number };
type Layout = {
  width: number;
  height: number;
  banks: Window[][];
  antennas: Point[];
  launch: Point;
  drift: number;
  rocket: number;
  focus: { x: number; width: number };
};
type Canvas = CanvasRenderingContext2D;

const BANK_TIMES = [240, 560, 880, 1200, 1520];
const ASCENT_TIME = 2890;

const fallback: Layout = {
  width: 720, height: 405,
  banks: Array.from({ length: BANK_TIMES.length }, (_, bank) => Array.from({ length: 6 }, (_, n) => ({
    x: 263 + n * 11, y: 323 - bank * 47, w: 7, h: 13,
  }))),
  antennas: [{ x: 299, y: 55 }, { x: 119, y: 248 }, { x: 414, y: 266 }, { x: 625, y: 226 }],
  launch: { x: 530, y: 324 },
  drift: 105, rocket: 1, focus: { x: 400, width: 395 },
};

const dusk: Layout = {
  width: 1672, height: 941,
  banks: [
    ...[[737, 771], [645, 680], [551, 586], [463, 498]].map(([top, bottom]) =>
      [[999, 1021], [1023, 1045], [1047, 1093], [1096, 1119], [1121, 1142]].map(([left, right]) => ({
        x: left, y: top, w: right - left, h: bottom - top,
      })),
    ),
    [1051, 1065, 1076].map((x) => ({ x, y: 396, w: 9, h: 11 })),
  ],
  antennas: [
    { x: 1143, y: 192 }, { x: 819, y: 641 }, { x: 357, y: 660 },
    { x: 1590, y: 614 }, { x: 58, y: 623 },
  ],
  launch: { x: 592, y: 683 },
  drift: 231, rocket: 2, focus: { x: 912, width: 886 },
};

function limit(value: number, low = 0, high = 1) {
  return Math.max(low, Math.min(high, value));
}

function fade(from: number, to: number, value: number) {
  const phase = limit((value - from) / (to - from));
  return phase * phase * (3 - phase * 2);
}

function random(seed: number) {
  return (Math.imul(seed ^ (seed >>> 17), 1597334677) >>> 0) / 4294967296;
}

function block(ctx: Canvas, color: string, x: number, y: number, w: number, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

function pixelCircle(ctx: Canvas, color: string, x: number, y: number, radius: number, band = 1) {
  const r = Math.round(radius);
  ctx.fillStyle = color;
  for (let row = -r; row <= r; row += band) {
    const width = Math.floor(Math.sqrt(r * r - row * row));
    ctx.fillRect(Math.round(x) - width, Math.round(y) + row, width * 2 + 1, band);
  }
}

function antenna(ctx: Canvas, point: Point, height: number) {
  const { x, y } = point;
  block(ctx, "#1d273a", x - 1, y, 3, height);
  block(ctx, "#606072", x, y + 2, 1, height - 2);
  for (let rung = 0; rung < 4; rung++) {
    const w = Math.floor(height * (.2 + rung * .10));
    block(ctx, "#252d42", x - w, y + Math.floor(height * (.25 + rung * .15)), w * 2 + 1, 2);
  }
}

function offlineFallback(ctx: Canvas) {
  const { width, height, launch } = fallback;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#242e49");
  gradient.addColorStop(.48, "#775665");
  gradient.addColorStop(.72, "#c58773");
  gradient.addColorStop(1, "#493f53");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  pixelCircle(ctx, "#e5af82", 547, 208, 88, 2);
  pixelCircle(ctx, "#f2bd8c", 547, 206, 80, 2);
  for (let n = 0; n < 23; n++) {
    const x = random(n * 7727 + 5) * width;
    const y = 61 + random(n * 1127 + 9) * 199;
    const w = 25 + random(n * 217 + 31) * 81;
    block(ctx, n % 3 ? "#996c74" : "#be857c", x, y, w, 2);
    block(ctx, "#c58c7f", x + 9, y + 2, w * .64);
  }

  for (let layer = 0; layer < 3; layer++) {
    const stride = 23 + layer * 11;
    const color = ["#976e78", "#574e62", "#323b50"][layer];
    for (let x = -7, n = 0; x < width; x += stride, n++) {
      const y = 265 + layer * 32 - random(n * 1357 + layer * 513) * (30 + layer * 8);
      const w = stride - 5 + random(n * 581 + layer * 27) * 8;
      block(ctx, color, x, y, w, height - y);
      block(ctx, color, x + 3, y - 5, w - 12, 5);
      for (let wy = y + 7; wy < height; wy += 11) {
        for (let wx = x + 4; wx < x + w - 4; wx += 7) {
          if (random(wx * 3151 + wy * 131) > .6) block(ctx, layer === 2 ? "#806978" : "#b38a86", wx, wy, 2, 3);
        }
      }
    }
  }

  for (const mast of fallback.antennas.slice(1)) antenna(ctx, mast, 55);

  block(ctx, "#222a3a", 245, 113, 114, 292);
  block(ctx, "#3e4456", 251, 118, 102, 287);
  block(ctx, "#4e4858", 251, 118, 12, 287);
  block(ctx, "#282d40", 341, 119, 18, 286);
  block(ctx, "#1b2638", 240, 112, 124, 7);
  block(ctx, "#746275", 245, 112, 114, 2);
  block(ctx, "#394258", 270, 98, 58, 14);
  block(ctx, "#716177", 271, 98, 53, 2);
  antenna(ctx, fallback.antennas[0], 44);
  for (let y = 123; y < height; y += 47) {
    block(ctx, "#272c3e", 247, y, 109, 4);
    block(ctx, "#5e5464", 252, y + 4, 101, 2);
    for (let brick = 0; brick < 6; brick++) {
      block(ctx, "#423f50", 254, y + 9 + brick * 7, 95);
    }
  }
  for (const bank of fallback.banks) for (const cell of bank) {
    block(ctx, "#555366", cell.x - 2, cell.y - 2, cell.w + 4, cell.h + 5);
    block(ctx, "#212d42", cell.x, cell.y, cell.w, cell.h);
    block(ctx, "#374456", cell.x + 1, cell.y + 1, cell.w - 2, cell.h - 2);
  }
  for (let y = 134; y < height; y += 22) block(ctx, "#656070", 344, y, 2, 3);

  block(ctx, "#222e41", launch.x - 35, launch.y, 73, 5);
  block(ctx, "#766777", launch.x - 33, launch.y, 69, 1);
  block(ctx, "#283247", launch.x - 20, launch.y + 4, 42, 29);
  block(ctx, "#293348", launch.x + 15, launch.y - 50, 3, 50);
  for (let rung = 0; rung < 5; rung++) {
    block(ctx, "#54586e", launch.x + 8, launch.y - 46 + rung * 10, 14, 1);
    block(ctx, "#353e54", launch.x + 21, launch.y - 49 + rung * 10, 1, 10);
  }
  block(ctx, "#8b6570", launch.x + 15, launch.y - 51, 2, 2);
}

function energize(ctx: Canvas, layout: Layout, ms: number) {
  for (const [index, bank] of layout.banks.entries()) {
    for (const [column, cell] of bank.entries()) {
      const live = fade(0, 300, ms - BANK_TIMES[index] - 15 * (column % 8));
      if (live <= 0) continue;

      const { x, y, w, h } = cell;
      const light = [.76, .54, .85, .47, .65][(index * 3 + column) % 5] * live;
      const tint = ["#ecc082", "#e5ae79", "#d99d7a", "#e4ac6d", "#f4ce94"][index];
      ctx.globalAlpha = .32 * light;
      block(ctx, "#e2a56e", x, y + h, w, Math.max(1, h * .07));
      ctx.globalAlpha = .97 * light;
      block(ctx, tint, x, y, w, h);
      if (w >= 12) {
        const rackWidth = Math.round(w * .32);
        const rackX = column % 2 ? x + 1 : x + w - rackWidth - 1;
        const rackY = y + h * (.4 + ((column + index) % 3) * .08);
        ctx.globalAlpha = .73 * light;
        block(ctx, "#252d44", rackX, rackY, rackWidth, y + h - rackY);
        block(ctx, "#594451", rackX + 1, rackY - 2, rackWidth - 1, 2);
        for (let slot = 0; slot < 3; slot++) {
          block(ctx, "#6d6270", rackX + 1, rackY + 2 + slot * 4, rackWidth - 3);
          block(ctx, slot % 2 ? "#80b4a9" : "#f7ba82", rackX + rackWidth - 3, rackY + 2 + slot * 4, 1, 1);
        }
        const lampX = column % 2 ? x + w - 6 : x + 5;
        ctx.globalAlpha = .37 * light;
        block(ctx, "#ffcc8b", lampX - 4, y + 3, 9, h * .44);
        ctx.globalAlpha = light;
        block(ctx, "#ffd6a1", lampX - 2, y + 3, 5, 2);
        if (w > 30) {
          ctx.globalAlpha = .75 * light;
          block(ctx, "#384155", x + 5, y + h - 11, 11, 9);
          block(ctx, "#a4b7a8", x + 6, y + h - 10, 8, 4);
          block(ctx, "#bb9d83", x + 5, y + h - 2, 18, 1);
        }
      } else {
        ctx.globalAlpha = light;
        block(ctx, "#f5c58b", x + 1, y + 2, w - 2, 4);
      }
      ctx.globalAlpha = 1;
    }
  }
}

function signal(ctx: Canvas, layout: Layout, ms: number) {
  const unit = Math.max(1, Math.round(layout.height / 390));
  for (const [i, { x, y }] of layout.antennas.entries()) {
    const age = ms - VICTORY_SIGNAL_MS - i * 145;
    const live = fade(0, 250, age);
    if (!live) continue;
    const breath = .82 + .18 * Math.cos(age / 420);
    const main = i === 0;
    ctx.globalAlpha = live * breath * (main ? .18 : .1);
    pixelCircle(ctx, "#f7a079", x, y, (main ? 4 : 2) * unit, unit);
    ctx.globalAlpha = live * breath * (main ? .92 : .73);
    block(ctx, "#ffb38c", x - unit, y - unit, unit * (main ? 3 : 2), unit * 2);
    block(ctx, "#ffebba", x, y - unit, unit, unit);

    const wave = fade(70, 700, age);
    if (wave > 0 && wave < 1) {
      const radius = Math.round((5 + wave * (i === 0 ? 30 : 15)) * unit);
      ctx.globalAlpha = .66 * Math.sin(Math.PI * wave);
      for (const side of [-1, 1]) {
        for (let n = -4; n <= 4; n++) {
          const angle = n * .14;
          block(ctx, "#ffc287", x + side * Math.cos(angle) * radius, y + Math.sin(angle) * radius, unit, unit);
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

const rocket = [
  "     l     ",
  "     L     ",
  "    lLs    ",
  "    lLs    ",
  "   olLso   ",
  "   olLso   ",
  "   owWsO   ",
  "   owWsO   ",
  "   olLsO   ",
  "   plLsP   ",
  "   ppPpP   ",
  "   olLsO   ",
  "   olLsO   ",
  "   olLsO   ",
  "  polLsOP  ",
  "  polLsoP  ",
  " pPolLsoPP ",
  " pPolLsoPP ",
  "pPPoooosPPP",
  "    owo    ",
] as const;

const rocketColors: Record<string, string> = {
  l: "#f5d6a6", L: "#ffe9c4", s: "#b3a79c", o: "#676d83", O: "#4b5775",
  w: "#4f779b", W: "#7db0c9", p: "#db8d6a", P: "#a9665a",
};

function flight(layout: Layout, ms: number) {
  const phase = Math.max(0, (ms - ASCENT_TIME) / 2920);
  const rise = layout.launch.y + 112 * layout.rocket;
  const advance = phase ** 1.74;
  return {
    x: layout.launch.x + layout.drift * phase ** 2.45,
    y: layout.launch.y - rise * advance,
    angle: Math.atan2(layout.drift * 2.45 * phase ** .71, rise * 1.74),
  };
}

function craft(ctx: Canvas, layout: Layout, ms: number) {
  const { x, y, angle } = flight(layout, ms);
  const unit = layout.rocket;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const ignition = fade(0, 260, ms - VICTORY_IGNITION_MS);

  ctx.globalAlpha = .69 + .31 * ignition;
  const left = -7 * unit;
  const right = 13 * unit;
  const top = -rocket.length * unit - 1;
  for (let row = top; row <= unit * 3; row++) {
    for (let column = left; column < right; column++) {
      const sx = Math.floor((column * cosine + row * sine) / unit + 5.5);
      const sy = Math.floor((-column * sine + row * cosine) / unit + rocket.length);
      const pixel = rocket[sy]?.[sx];
      if (pixel && pixel !== " ") block(ctx, rocketColors[pixel], x + column, y + row, 1);
    }
  }
  if (ignition) {
    const pulse = 2 * Math.sin(ms / 35) + 2 * Math.cos(ms / 52);
    const length = (.8 + ignition * 7 + pulse * .45) * unit;
    ctx.globalAlpha = ignition * .26;
    pixelCircle(ctx, "#f09b62", x - sine * 3, y + cosine * 3, 5 * unit, unit);
    for (let i = 0; i < length; i += unit) {
      const reach = i / length;
      const radius = Math.max(unit, (2.5 - 2 * reach) * unit);
      ctx.globalAlpha = (1 - reach * .68) * ignition;
      block(ctx, reach > .62 ? "#e78a62" : "#ffe9b1", x - sine * i - radius, y + cosine * i, radius * 2, unit);
      if (reach < .7) block(ctx, "#fff5d6", x - sine * i, y + cosine * i, unit, unit);
    }
  }
  ctx.globalAlpha = 1;
}

function exhaust(ctx: Canvas, layout: Layout, ms: number) {
  const unit = layout.rocket;
  const { x, y } = layout.launch;
  const bed = fade(0, 240, ms - VICTORY_IGNITION_MS) * (1 - fade(400, 2180, ms - ASCENT_TIME));
  if (bed) {
    ctx.globalAlpha = bed * .13;
    pixelCircle(ctx, "#edaa78", x, y - 1, 22 * unit, unit);
    ctx.globalAlpha = bed * .16;
    pixelCircle(ctx, "#ffab67", x, y - 1, 14 * unit, unit);
    ctx.globalAlpha = bed * .54;
    block(ctx, "#f4b077", x - 11 * unit, y + 1, 22 * unit, unit);
  }
  const spacing = 22;
  const emissionStart = Math.max(0, Math.floor((ms - VICTORY_IGNITION_MS - 2050) / spacing));
  const emissionEnd = Math.floor((Math.min(ms, 5700) - VICTORY_IGNITION_MS) / spacing);
  for (let n = emissionStart; n <= emissionEnd; n++) {
    const at = VICTORY_IGNITION_MS + n * spacing;
    const age = (ms - at) / 1000;
    if (age < 0 || age > 2.05) continue;
    const source = flight(layout, at);
    const emit = fade(0, 240, at - VICTORY_IGNITION_MS);
    const cooling = 1 - age / 2.05;
    const side = random(n * 719 + 97) - .5;
    const wind = age * (6 + 11 * age);
    const thrust = age * Math.cos(source.angle) * (11 + random(n * 433 + 17) * 16);
    const offset = random(n * 1499 + 473) * 8;
    const px = source.x + (wind + side * (offset + age * 32) * Math.min(1, age * 3) - Math.sin(source.angle) * thrust) * unit;
    const py = Math.min(layout.launch.y + (offset + age * 3) * unit, source.y + (thrust + offset) * unit);
    const radius = (1.2 + age * 3.5 + random(n * 101 + 6) * 3) * unit;
    const heat = 1 - fade(.04, .45, age);
    ctx.globalAlpha = emit * cooling * (.12 + heat * .16);
    pixelCircle(ctx, heat > .55 ? "#ffbd86" : "#a48cac", px, py, radius, unit);
    ctx.globalAlpha *= .55;
    pixelCircle(ctx, heat > .55 ? "#ffe5af" : "#747599", px + unit, py - unit, radius * .54, unit);
  }
  for (let lag = 530; lag >= 0; lag -= 9) {
    const at = ms - lag;
    if (at < ASCENT_TIME || at > 5700) continue;
    const source = flight(layout, at);
    const age = lag / 530;
    const lift = 8 * age * unit;
    const width = unit * (1.2 + 2 * Math.sin(age * Math.PI));
    ctx.globalAlpha = .38 * (1 - age) ** 1.55;
    block(ctx, age < .24 ? "#ffdfaa" : "#f6a575", source.x - width + lift * .4, source.y + lift, width * 2, unit * (1.3 + 2 * age));
  }
  ctx.globalAlpha = 1;
}

function transform(plot: Layout, width: number, height: number) {
  const scale = Math.min(height / plot.height, width / plot.focus.width);
  const virtualWidth = Math.max(1, Math.round(width / scale));
  const virtualHeight = Math.max(1, Math.round(height / scale));
  const x = virtualWidth < plot.width
    ? Math.round(limit(plot.focus.x - virtualWidth / 2, 0, plot.width - virtualWidth))
    : Math.round((plot.width - virtualWidth) / 2);
  const y = Math.round((plot.height - virtualHeight) * .53);
  return { width: virtualWidth, height: virtualHeight, x, y };
}

function matte(ctx: Canvas, layout: Layout, plate: HTMLImageElement | null, x: number, y: number) {
  const { width, height } = layout;
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;
  const top = plate ? "#232860" : "#242e49";
  const sky = ctx.createLinearGradient(0, 0, 0, canvasHeight);
  sky.addColorStop(0, "#151a38");
  sky.addColorStop(limit((-y) / canvasHeight), top);
  sky.addColorStop(limit((height * .66 - y) / canvasHeight), "#554274");
  sky.addColorStop(limit((height - y) / canvasHeight), "#111c34");
  sky.addColorStop(1, "#0d1526");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  let art: CanvasImageSource;
  if (plate) {
    art = plate;
  } else {
    const offline = ctx.canvas.ownerDocument.createElement("canvas");
    offline.width = width;
    offline.height = height;
    const offlineCtx = offline.getContext("2d");
    if (offlineCtx) offlineFallback(offlineCtx);
    art = offline;
  }
  ctx.save();
  ctx.translate(-x, -y);
  ctx.imageSmoothingEnabled = false;
  const upper = -y;
  const lower = canvasHeight + y - height;
  if (upper > 0) {
    ctx.drawImage(art, 0, 0, width, 1, 0, -upper, width, upper);
    const fog = ctx.createLinearGradient(0, -upper, 0, 0);
    fog.addColorStop(0, "#151a38");
    fog.addColorStop(1, "#151a3800");
    ctx.fillStyle = fog;
    ctx.fillRect(0, -upper, width, upper);
  }
  if (lower > 0) {
    ctx.drawImage(art, 0, height - 1, width, 1, 0, height, width, lower);
    const fog = ctx.createLinearGradient(0, height, 0, height + lower);
    fog.addColorStop(0, "#0d152600");
    fog.addColorStop(.52, "#0d1526dc");
    fog.addColorStop(1, "#0d1526");
    ctx.fillStyle = fog;
    ctx.fillRect(0, height, width, lower);
  }
  ctx.drawImage(art, 0, 0, width, height);
  if (x < 0) {
    const extension = -x;
    const strip = Math.min(extension, Math.round(width * .19));
    for (const side of [-1, 1]) {
      const seam = side === -1 ? 0 : width;
      ctx.save();
      ctx.translate(seam, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(art, side === -1 ? 0 : width - strip, 0, strip, height,
        side === -1 ? 0 : -extension, 0, extension, height);
      const depth = ctx.createLinearGradient(0, 0, side === -1 ? extension : -extension, 0);
      depth.addColorStop(0, "#17203e00");
      depth.addColorStop(1, "#17203e8a");
      ctx.fillStyle = depth;
      ctx.fillRect(side === -1 ? 0 : -extension, 0, extension, height);
      ctx.restore();
    }
  }
  ctx.restore();
}

type Background = { canvas: HTMLCanvasElement; plate: HTMLImageElement | null };
const backgrounds = new WeakMap<HTMLCanvasElement, Background>();

export function drawVictoryFrame(canvas: HTMLCanvasElement, plate: HTMLImageElement | null, elapsedMs: number): void {
  const ready = plate?.complete && plate.naturalWidth === dusk.width && plate.naturalHeight === dusk.height ? plate : null;
  const layout = ready ? dusk : fallback;
  const view = transform(layout, canvas.clientWidth || layout.width, canvas.clientHeight || layout.height);
  const resized = canvas.width !== view.width || canvas.height !== view.height;
  if (resized) {
    canvas.width = view.width;
    canvas.height = view.height;
  }
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;

  const background = backgrounds.get(canvas);
  const source = background?.canvas ?? canvas.ownerDocument.createElement("canvas");
  if (!background || resized || background.plate !== ready) {
    source.width = view.width;
    source.height = view.height;
    const backgroundCtx = source.getContext("2d", { alpha: false });
    if (backgroundCtx) {
      matte(backgroundCtx, layout, ready, view.x, view.y);
      backgrounds.set(canvas, { canvas: source, plate: ready });
    }
  }
  ctx.drawImage(source, 0, 0);
  const ms = limit(elapsedMs, 0, VICTORY_DURATION_MS);
  ctx.save();
  ctx.translate(-view.x, -view.y);
  ctx.beginPath();
  ctx.rect(0, 0, layout.width, layout.height);
  ctx.clip();
  energize(ctx, layout, ms);
  signal(ctx, layout, ms);
  exhaust(ctx, layout, ms);
  if (ms < 5900) craft(ctx, layout, ms);
  ctx.restore();
}
