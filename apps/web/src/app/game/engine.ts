export const WIDTH = 480
export const VIEW_HEIGHT = 450
export const STEP_MS = 1000 / 60
export const HARDCORE_REWARD_LIMIT_MS = 120_000
export const HARDCORE_MAX_FRAMES = HARDCORE_REWARD_LIMIT_MS / STEP_MS

const GRAVITY = 0.39
const JUMP_SPEED = 9.1
const RUN_SPEED = 3.6
const PLAYER_WIDTH = 24
const PLAYER_HEIGHT = 32
const WORK_TIME = 38

export type AgentId = "codex" | "claude" | "pi" | "fx"
export type GameMode = "standard" | "hardcore"
export type Input = { left?: boolean; right?: boolean; jump?: boolean; use?: boolean }
type Status = "playing" | "won" | "lost"
type Rect = { x: number; y: number; w: number; h: number }
type PlatformKind = "floor" | "ledge" | "catwalk" | "bridge" | "lift" | "shuttle"
type Platform = Rect & { kind: PlatformKind }
type KeyBranch = {
  junction: Platform
  ledges: Platform[]
  keycard: Rect
  minX: number
  maxX: number
}
type Hazard = Rect & { kind: "fan" | "spikes" | "arc"; active: boolean; charging?: boolean }
type Crew = { id: AgentId; x: number; y: number; mode: "waiting" | "following" | "working" }
type Duty = {
  id: AgentId
  agent: AgentId
  x: number
  y: number
  label: string
  active: boolean
  complete: boolean
  workX: number
  workY: number
  elapsed: number
  mechanism: Platform
  destination: Platform
  hazard?: Hazard
}
export type Rescue = {
  agent: AgentId
  branch: KeyBranch
  cell: Rect & { readerX: number }
}
type Stage = {
  name: string
  rescue: Rescue | null
  height: number
  spawn: { x: number; y: number }
  route: Platform[]
  exit: Rect
  duties: Duty[]
  hazards: Hazard[]
  hardcoreHazards: Hazard[]
}

export type Game = {
  mode: GameMode
  stageIndex: number
  lives: number
  status: Status
  player: Rect & { vx: number; vy: number; facing: -1 | 1 }
  cameraY: number
  cameraLeadX: number
  frame: number
  crew: Crew[]
  duties: Duty[]
  platforms: Platform[]
  hazards: Hazard[]
  exit: Rect & { ready: boolean }
  hasKey: boolean
  prompt: string | null
  notice: string | null
  recruited: AgentId[]
  groundedOn: Platform | null
  coyote: number
  jumpBuffer: number
  jumpHeld: boolean
  useHeld: boolean
  noticeUntil: number
  trail: { x: number; y: number; platform: Platform | null }[]
}

export const AGENT_NAMES: Record<AgentId, string> = {
  codex: "Codex",
  claude: "Claude Code",
  pi: "Pi",
  fx: "Fx",
}

export const CREW_SIZE = Object.keys(AGENT_NAMES).length

const LABELS: Record<AgentId, string> = {
  codex: "Repair bridge",
  claude: "Hold lift switch",
  pi: "Enter vent",
  fx: "Power shuttle",
}

function surface(x: number, y: number, w: number, kind: PlatformKind = "ledge"): Platform {
  return { x, y, w, h: kind === "floor" ? 20 : 12, kind }
}

type Obstacle = "spikes-left" | "spikes-right" | "arc"
type CourseSection = ReturnType<typeof ledge> | { agent: AgentId; side: "left" | "right" }

function ledge(center: number, width: number, rise: number, obstacle?: Obstacle, hardcoreObstacle?: Obstacle) {
  return { center, width, rise, obstacle, hardcoreObstacle }
}

function trap(platform: Platform, obstacle: Obstacle): Hazard {
  const { x, y, w } = platform
  if (obstacle === "arc") {
    return { x: x + w / 2 - 16, y: y - 24, w: 32, h: 24, kind: "arc", active: false }
  }
  return { x: obstacle === "spikes-left" ? x : x + w - 25, y: y - 12, w: 25, h: 12, kind: "spikes", active: true }
}

function keyBranch(junction: Platform, outward: -1 | 1, difficulty: number): KeyBranch {
  const rim = outward === 1 ? WIDTH : 0
  const rises = [
    [46, 96, 154, 179],
    [50, 108, 158, 126],
    [44, 94, 152, 181],
    [49, 107, 160, 134],
  ][difficulty]
  const firstOffset = outward === 1 ? -6 : -17
  const ledges = [firstOffset, 108, 222, 334].map((offset, index) => {
    const width = index === 3 ? 74 : 60
    return surface(rim + outward * offset - width / 2, junction.y - rises[index], width, "catwalk")
  })
  const end = ledges.at(-1)!
  const keyCenter = end.x + end.w / 2 + outward * 10
  return {
    junction, ledges,
    keycard: { x: keyCenter - 11, y: end.y - 24, w: 22, h: 15 },
    minX: Math.min(0, end.x - 28), maxX: Math.max(WIDTH, end.x + end.w + 28),
  }
}

function buildStage(name: string, reward: AgentId | null, difficulty: number, sections: CourseSection[]): Stage {
  const approachRise = 65 + difficulty * 2
  const stationRise = 168
  const climb = sections.reduce((height, section) =>
    height + ("rise" in section ? section.rise : approachRise + stationRise), 0)
  const roofY = 192
  const floor = surface(30, roofY + climb, WIDTH - 60, "floor")
  const route = [floor]
  const hazards: Hazard[] = [{ x: 209, y: floor.y - 16, w: 62, h: 16, kind: "spikes", active: true }]
  const hardcoreHazards: Hazard[] = []
  const duties: Duty[] = []
  let y = floor.y
  for (const section of sections) {
    if ("rise" in section) {
      const { center, width, rise, obstacle, hardcoreObstacle } = section
      y -= rise
      const platform = surface(center - width / 2, y, width)
      route.push(platform)
      if (obstacle) hazards.push(trap(platform, obstacle))
      if (hardcoreObstacle) hardcoreHazards.push(trap(platform, hardcoreObstacle))
      continue
    }
    const { agent, side } = section
    const rect = (x: number, width: number) => side === "left" ? x : WIDTH - x - width
    y -= approachRise
    const approach = surface(rect(62, 108 - difficulty * 8), y, 108 - difficulty * 8)
    const mechanism = {
      codex: surface(rect(109, 154), y - 79, 154, "bridge"),
      claude: surface(rect(162, 70), y, 70, "lift"),
      pi: surface(rect(136, 126), y - 81, 126),
      fx: surface(rect(134, 76), y - 52, 76, "shuttle"),
    }[agent]
    const destX = agent === "fx" ? 258 : agent === "claude" ? 158 : 207
    const destination = surface(rect(destX, 112 - difficulty * 6), y - stationRise, 112 - difficulty * 6)
    const workX = approach.x + approach.w / 2
    const hazard: Hazard | undefined = agent === "pi" ? {
      x: mechanism.x - 28, y: mechanism.y - 34, w: mechanism.w + 56, h: 34,
      kind: "fan", active: true,
    } : undefined
    if (hazard) hazards.push(hazard)
    route.push(approach, destination)
    duties.push({
      id: agent,
      agent,
      x: workX,
      y,
      label: LABELS[agent],
      active: false,
      complete: false,
      workX: agent === "pi" ? mechanism.x + mechanism.w / 2 : workX,
      workY: agent === "pi" ? mechanism.y : y,
      elapsed: 0,
      mechanism,
      destination,
      hazard,
    })
    y = destination.y
  }
  const roof = route.at(-1)!
  const approach = route.at(-2)!
  const roofCenter = roof.x + roof.w / 2
  const outward = roofCenter < WIDTH / 2 ? -1 : 1
  const cellCenter = roofCenter - outward * 22
  return {
    name,
    rescue: reward ? {
      agent: reward,
      branch: keyBranch(approach, outward, difficulty),
      cell: { x: cellCenter - 20, y: roof.y - 44, w: 40, h: 44, readerX: cellCenter - outward * 18 },
    } : null,
    height: floor.y + 40,
    spawn: { x: difficulty % 2 === 0 ? 89 : 359, y: floor.y - PLAYER_HEIGHT },
    route,
    exit: { x: (reward ? roofCenter + outward * 24 : roofCenter) - 17, y: roof.y - 46, w: 34, h: 46 },
    duties,
    hazards,
    hardcoreHazards,
  }
}

export const STAGES = [
  buildStage("Loading Dock", "codex", 0, [
    ledge(158, 104, 60, undefined, "spikes-right"), ledge(263, 110, 66, "spikes-right"), ledge(364, 90, 66, undefined, "spikes-right"),
    ledge(297, 80, 79), ledge(194, 96, 69, "spikes-left"), ledge(92, 92, 71),
    ledge(141, 70, 82), ledge(240, 96, 64, "spikes-right"), ledge(323, 74, 76, undefined, "arc"),
    ledge(395, 100, 84),
  ]),
  buildStage("Machine Room", "claude", 1, [
    ledge(312, 94, 68, "spikes-left"), ledge(206, 76, 72, undefined, "spikes-left"), ledge(109, 84, 75),
    { agent: "codex", side: "left" },
    ledge(372, 100, 74, "arc"), ledge(285, 68, 78), ledge(190, 98, 69, "spikes-left"),
    ledge(87, 82, 72, undefined, "spikes-left"), ledge(157, 80, 79), ledge(255, 96, 72, "spikes-right"),
    ledge(324, 74, 78, undefined, "arc"), ledge(398, 100, 83),
  ]),
  buildStage("Cooling Stack", "pi", 2, [
    ledge(165, 94, 70, "spikes-right"), ledge(261, 74, 73, undefined, "arc"), ledge(365, 102, 75, "arc"),
    { agent: "claude", side: "right" },
    ledge(181, 94, 75, "spikes-left"), ledge(86, 78, 79, undefined, "spikes-left"), ledge(164, 72, 77),
    ledge(258, 102, 67, "arc"), ledge(163, 84, 76),
    { agent: "codex", side: "left" },
    ledge(355, 94, 78, "spikes-right"), ledge(284, 66, 77), ledge(163, 90, 70, undefined, "spikes-left"),
    ledge(88, 98, 81),
  ]),
  buildStage("Antenna Deck", "fx", 3, [
    ledge(306, 94, 70, "spikes-left"), ledge(205, 76, 70, undefined, "arc"), ledge(105, 100, 80, "arc"),
    { agent: "pi", side: "left" },
    ledge(351, 94, 73, "spikes-right"), ledge(282, 68, 78), ledge(185, 94, 71),
    ledge(82, 78, 76, undefined, "spikes-left"),
    { agent: "codex", side: "left" },
    ledge(359, 100, 75, "arc"), ledge(286, 66, 80), ledge(186, 94, 72, "spikes-left"),
    ledge(102, 72, 79), ledge(186, 82, 72), ledge(275, 88, 75, undefined, "spikes-right"),
    { agent: "claude", side: "right" },
    ledge(178, 72, 79), ledge(80, 96, 74, "spikes-left"), ledge(158, 66, 80),
    ledge(253, 100, 72, "arc"), ledge(326, 74, 80), ledge(402, 100, 84),
  ]),
  buildStage("Signal Spire", null, 4, [
    ledge(142, 104, 73, "spikes-right"), ledge(234, 70, 79, undefined, "arc"), ledge(149, 98, 75, "arc"),
    { agent: "fx", side: "left" },
    ledge(393, 90, 79, "spikes-right"), ledge(290, 68, 77), ledge(197, 100, 70, "arc"),
    ledge(105, 74, 84),
    { agent: "codex", side: "left" },
    ledge(349, 94, 80, "spikes-right"), ledge(280, 66, 82), ledge(184, 102, 73, "spikes-left"),
    ledge(91, 74, 80),
    { agent: "pi", side: "left" },
    ledge(349, 100, 76, "arc"), ledge(408, 72, 77, undefined, "spikes-right"),
    { agent: "claude", side: "right" },
    ledge(187, 102, 78, "spikes-left"), ledge(84, 68, 84), ledge(162, 82, 79, undefined, "spikes-right"),
    ledge(261, 98, 73, "arc"), ledge(350, 68, 82), ledge(400, 100, 86),
  ]),
]

function updateArcs(game: Game) {
  for (const hazard of game.hazards) {
    if (hazard.kind !== "arc") continue
    const phase = (game.frame + hazard.y) % 180
    hazard.active = phase < 52
    hazard.charging = phase >= 148
  }
}

function loadStage(game: Game, stageIndex: number, checkpoint: boolean) {
  const stage = STAGES[stageIndex]
  const completed = checkpoint ? game.duties.filter((duty) => duty.complete).map((duty) => duty.id) : []
  game.hasKey = checkpoint && game.hasKey
  game.stageIndex = stageIndex
  const hazards = game.mode === "hardcore" ? [...stage.hazards, ...stage.hardcoreHazards] : stage.hazards
  game.hazards = hazards.map((hazard) => ({ ...hazard }))
  game.duties = stage.duties.map((duty) => {
    const complete = completed.includes(duty.id)
    const hazard = game.hazards.find((candidate) => candidate.x === duty.hazard?.x && candidate.y === duty.hazard.y)
    if (hazard) hazard.active = !complete
    return { ...duty, mechanism: { ...duty.mechanism }, hazard, complete }
  })
  game.platforms = [...stage.route, ...(stage.rescue?.branch.ledges ?? []), ...game.duties.flatMap((duty) =>
    duty.complete || duty.id === "pi" ? [duty.mechanism] : [],
  )]
  const rescue = stage.rescue
  const ready = rescue ? game.recruited.includes(rescue.agent) : game.duties.every((duty) => duty.complete)
  game.exit = { ...stage.exit, ready }
  game.player = { ...stage.spawn, w: PLAYER_WIDTH, h: PLAYER_HEIGHT, vx: 0, vy: 0, facing: 1 }
  game.cameraY = stage.height - VIEW_HEIGHT
  game.cameraLeadX = 0
  game.crew = game.recruited.map((id, index) => ({
    id,
    x: stage.spawn.x + PLAYER_WIDTH / 2 - (index + 1) * 22,
    y: stage.spawn.y + PLAYER_HEIGHT,
    mode: "following",
  }))
  if (rescue && !game.exit.ready) {
    game.crew.push({
      id: rescue.agent, x: rescue.cell.x + rescue.cell.w / 2,
      y: rescue.cell.y + rescue.cell.h, mode: "waiting",
    })
  }
  game.groundedOn = stage.route[0]
  game.coyote = 0
  game.jumpBuffer = 0
  game.prompt = null
  game.trail = []
}

export function createGame(mode: GameMode = "standard"): Game {
  const game: Game = {
    mode,
    stageIndex: 0,
    lives: mode === "hardcore" ? 1 : 3,
    status: "playing",
    player: { x: 0, y: 0, w: PLAYER_WIDTH, h: PLAYER_HEIGHT, vx: 0, vy: 0, facing: 1 },
    cameraY: 0,
    cameraLeadX: 0,
    frame: 0,
    crew: [],
    duties: [],
    platforms: [],
    hazards: [],
    exit: { x: 0, y: 0, w: 0, h: 0, ready: false },
    hasKey: false,
    prompt: null,
    notice: null,
    recruited: [],
    groundedOn: null,
    coyote: 0,
    jumpBuffer: 0,
    jumpHeld: false,
    useHeld: false,
    noticeUntil: 0,
    trail: [],
  }
  loadStage(game, 0, false)
  return game
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function near(player: Rect, x: number, y: number, horizontal: number, vertical: number) {
  return Math.abs(player.x + player.w / 2 - x) <= horizontal &&
    Math.abs(player.y + player.h - y) <= vertical
}

function say(game: Game, text: string) {
  game.notice = text
  game.noticeUntil = game.frame + 150
}

function finishDuty(game: Game, duty: Duty) {
  duty.active = false
  duty.complete = true
  const crew = game.crew.find((member) => member.id === duty.agent)
  if (crew) crew.mode = "following"
  if (!STAGES[game.stageIndex].rescue) game.exit.ready = game.duties.every((item) => item.complete)
}

function advanceDuty(game: Game, duty: Duty) {
  if (duty.active && duty.id !== "fx") duty.elapsed++
  if ((duty.id === "codex" || duty.id === "pi") && duty.active && duty.elapsed >= WORK_TIME) {
    if (duty.hazard) duty.hazard.active = false
    else game.platforms.push(duty.mechanism)
    finishDuty(game, duty)
  }
  if (duty.id !== "claude" && duty.id !== "fx") return
  if (!duty.active && !duty.complete) return

  const platform = duty.mechanism
  const home = STAGES[game.stageIndex].duties.find((item) => item.id === duty.id)!.mechanism
  const riding = game.groundedOn === platform
  const out = game.groundedOn === duty.destination
  if (duty.active && out) finishDuty(game, duty)

  const move = (n: number, target: number, speed: number) =>
    n + clamp(target - n, -speed, speed)
  const previousX = platform.x
  const previousY = platform.y
  if (duty.id === "claude") {
    const top = duty.y - 121
    const target = riding || (platform.y < home.y && duty.elapsed % 115 < 90) ? top : home.y
    platform.y = move(platform.y, target, 1.75)
    if (duty.complete) duty.elapsed++
  } else {
    const destination = duty.destination
    const farX = destination.x < home.x ? destination.x + destination.w - 34 : destination.x - 42
    // An empty shuttle returns to the boarding bay and waits for its rider.
    if (riding || duty.elapsed % 240 !== 0) duty.elapsed++
    const phase = duty.elapsed % 240
    const progress = Math.min(phase, 240 - phase, 72) / 72
    platform.x = home.x + (farX - home.x) * progress
    platform.y = home.y - 75 * progress
  }
  if (riding) {
    game.player.x += platform.x - previousX
    game.player.y += platform.y - previousY
  }
}

function movePlayer(game: Game, input: Input) {
  const player = game.player
  const direction = Number(!!input.right) - Number(!!input.left)
  player.vx = direction * RUN_SPEED
  if (direction) player.facing = direction < 0 ? -1 : 1
  if (game.groundedOn) game.coyote = 5
  else game.coyote = Math.max(0, game.coyote - 1)
  if (input.jump && !game.jumpHeld) game.jumpBuffer = 6
  else game.jumpBuffer = Math.max(0, game.jumpBuffer - 1)
  if (game.jumpBuffer && game.coyote) {
    player.vy = -JUMP_SPEED
    game.groundedOn = null
    game.coyote = 0
    game.jumpBuffer = 0
  }
  const feet = player.y + player.h
  const branch = STAGES[game.stageIndex].rescue?.branch
  player.x = clamp(player.x + player.vx, branch?.minX ?? 0, (branch?.maxX ?? WIDTH) - player.w)
  player.vy = Math.min(14, player.vy + GRAVITY)
  player.y += player.vy
  game.groundedOn = null
  if (player.vy >= 0) {
    for (const platform of game.platforms) {
      if (player.x + player.w <= platform.x || player.x >= platform.x + platform.w) continue
      if (feet > platform.y + 0.001 || player.y + player.h < platform.y) continue
      player.y = platform.y - player.h
      player.vy = 0
      game.groundedOn = platform
    }
  }
}

// Grounded samples use platform-local x so riders follow a lift or shuttle as it moves.
function followOnPlatform(crew: Crew, platform: Platform, localX: number, facing: number, index: number, count: number) {
  const inset = 9
  const gap = Math.min(22, (platform.w - 2 * inset) / count)
  const span = gap * count
  const start = clamp(localX - (facing === 1 ? span : 0), inset, platform.w - inset - span)
  const leader = clamp(Math.round((localX - start) / gap), 0, count)
  const slot = (leader - facing * (index + 1) + count + 1) % (count + 1)
  const target = platform.x + start + slot * gap
  crew.x = clamp(crew.x + (target - crew.x) * 0.22, platform.x + inset, platform.x + platform.w - inset)
  crew.y = platform.y
}

function updateCrew(game: Game) {
  const { player } = game
  const center = player.x + player.w / 2
  game.trail.push({ x: center - (game.groundedOn?.x ?? 0), y: player.y + player.h, platform: game.groundedOn })
  if (game.trail.length > 48) game.trail.shift()
  for (const [index, crew] of game.crew.entries()) {
    if (crew.mode === "waiting") continue
    const trail = game.trail[Math.max(0, game.trail.length - 1 - (index + 1) * 10)]
    const duty = crew.mode === "working" ? game.duties.find((item) => item.agent === crew.id) : undefined
    if (!duty && trail.platform) {
      followOnPlatform(crew, trail.platform, trail.x, player.facing, index, game.recruited.length)
    } else {
      const targetX = duty?.workX ?? trail.x
      const targetY = duty?.workY ?? trail.y
      crew.x += (targetX - crew.x) * 0.22
      crew.y += (targetY - crew.y) * 0.22
    }
  }
}

function loseLife(game: Game) {
  game.lives--
  if (game.lives === 0) {
    game.status = "lost"
    game.prompt = null
    game.notice = null
  } else {
    loadStage(game, game.stageIndex, true)
    say(game, "Back at the floor checkpoint")
  }
}

export function stepGame(game: Game, input: Input) {
  if (game.status !== "playing") return
  const stage = STAGES[game.stageIndex]
  const usePressed = input.use && !game.useHeld
  game.frame++
  updateArcs(game)
  if (game.frame >= game.noticeUntil) game.notice = null
  for (const duty of game.duties) advanceDuty(game, duty)
  movePlayer(game, input)
  updateCrew(game)
  const duty = game.duties.find((item) => !item.active && !item.complete &&
    game.recruited.includes(item.agent) && near(game.player, item.x, item.y, 44, 32))
  game.prompt = duty?.label ?? null
  if (duty && usePressed) {
    duty.active = true
    const crew = game.crew.find((member) => member.id === duty.agent)
    if (crew) crew.mode = "working"
    if (duty.id === "claude" || duty.id === "fx") game.platforms.push(duty.mechanism)
    game.prompt = null
  }
  game.jumpHeld = !!input.jump
  game.useHeld = !!input.use
  const targetY = clamp(game.player.y - VIEW_HEIGHT * 0.50, 0, stage.height - VIEW_HEIGHT)
  game.cameraY += (targetY - game.cameraY) * 0.13
  let lead = 0
  const bay = stage.rescue?.branch
  if (bay && !game.exit.ready) {
    const outward = bay.minX < 0 ? -1 : 1
    const distance = outward * (game.player.x + game.player.w / 2 - bay.junction.x - bay.junction.w / 2)
    const height = clamp((bay.junction.y + 74 - game.player.y - game.player.h) / 74, 0, 1)
    const direction = game.hasKey ? -clamp(distance / 90, 0, 1) : clamp((distance + 64) / 64, 0, 1)
    lead = outward * 80 * direction * height
  }
  game.cameraLeadX += (lead - game.cameraLeadX) * 0.16
  if (game.player.y > stage.height + 22 ||
    game.hazards.some((hazard) => hazard.active && overlaps(game.player, hazard))) {
    loseLife(game)
    return
  }
  const onRoof = game.groundedOn === stage.route.at(-1)
  const rescue = stage.rescue
  if (!rescue) {
    if (game.exit.ready && onRoof && overlaps(game.player, game.exit)) {
      game.prompt = "Restore signal"
      if (usePressed) {
        game.status = "won"
        game.prompt = null
      }
    }
    return
  }
  const { branch, cell, agent } = rescue
  if (!game.exit.ready && !game.hasKey && game.groundedOn === branch.ledges.at(-1) && overlaps(game.player, branch.keycard)) {
    game.hasKey = true
    say(game, "Keycard collected")
  }
  if (!game.exit.ready && game.hasKey && onRoof &&
    near(game.player, cell.readerX, cell.y + cell.h, 22, 8) && game.duties.every((item) => item.complete)) {
    game.prompt = `Free ${AGENT_NAMES[agent]}`
    if (usePressed) {
      game.crew.find((member) => member.id === agent)!.mode = "following"
      game.recruited.push(agent)
      if (game.mode === "standard") game.lives++
      game.hasKey = false
      game.exit.ready = true
      game.prompt = null
      say(game, `${AGENT_NAMES[agent]} rescued` + (game.mode === "standard" ? " · +1 life" : ""))
    }
  } else if (game.exit.ready && overlaps(game.player, game.exit)) {
    loadStage(game, game.stageIndex + 1, false)
  }
}

// The fifth bit reproduces the input release that happens when the game pauses.
export function recordInput(input: Input, released: boolean) {
  const bits = Number(!!input.left) + Number(!!input.right) * 2 +
    Number(!!input.jump) * 4 + Number(!!input.use) * 8 + Number(released) * 16
  return bits.toString(32)
}

export function isRewardRun(elapsedMs: number, frames: number) {
  return Number.isInteger(elapsedMs) && frames > 0 &&
    elapsedMs >= Math.floor(frames * STEP_MS) && elapsedMs < HARDCORE_REWARD_LIMIT_MS
}

export function verifyHardcoreReplay(replay: string, elapsedMs: number) {
  if (replay.length > HARDCORE_MAX_FRAMES || !isRewardRun(elapsedMs, replay.length) || !/^[0-9a-v]+$/.test(replay)) return false
  const game = createGame("hardcore")
  for (const encoded of replay) {
    if (game.status !== "playing") return false
    const bits = parseInt(encoded, 32)
    if (bits & 16) {
      game.jumpHeld = false
      game.useHeld = false
    }
    stepGame(game, { left: !!(bits & 1), right: !!(bits & 2), jump: !!(bits & 4), use: !!(bits & 8) })
  }
  return game.status === "won"
}

const STATION_HINTS: Record<AgentId, string> = {
  codex: "Find the bridge controls",
  claude: "Find the lift switch",
  pi: "Find the vent",
  fx: "Find the shuttle controls",
}

const WORK_HINTS: Record<AgentId, string> = {
  codex: "Codex is repairing the bridge",
  claude: "Ride the lift up",
  pi: "Pi is shutting down the fan",
  fx: "Ride the shuttle across",
}

export function getContextHint(game: Game) {
  const nextDuty = game.duties.find((duty) => !duty.complete)
  if (nextDuty) return nextDuty.active ? WORK_HINTS[nextDuty.agent] : STATION_HINTS[nextDuty.agent]
  const rescue = STAGES[game.stageIndex].rescue
  if (!rescue) return "Reach the rooftop antenna"
  if (game.exit.ready) return "Enter the exit"
  if (!game.hasKey) return "Find the keycard on the side path"
  return `Return to ${AGENT_NAMES[rescue.agent]}'s cell`
}

export function getSnapshot(game: Game) {
  return {
    stageIndex: game.stageIndex,
    stageName: STAGES[game.stageIndex].name,
    lives: game.lives,
    hasKey: game.hasKey,
    status: game.status,
    prompt: game.prompt,
    hint: getContextHint(game),
    notice: game.notice,
    recruited: [...game.recruited],
  }
}
