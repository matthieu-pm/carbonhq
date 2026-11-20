export const WIDTH = 480
export const VIEW_HEIGHT = 450

const GRAVITY = 0.43
const JUMP_SPEED = 10.2
const RUN_SPEED = 4.3
const PLAYER_WIDTH = 24
const PLAYER_HEIGHT = 32
const WORK_TIME = 38

export type AgentId = "codex" | "claude" | "pi" | "fx"
export type Input = { left?: boolean; right?: boolean; jump?: boolean; use?: boolean }
type Status = "playing" | "won" | "lost"
type Rect = { x: number; y: number; w: number; h: number }
type PlatformKind = "floor" | "ledge" | "bridge" | "lift" | "shuttle"
type Platform = Rect & { kind: PlatformKind }
type Hazard = Rect & { kind: "fan" | "spikes"; active: boolean }
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
type Stage = {
  name: string
  height: number
  spawn: { x: number; y: number }
  route: Platform[]
  exit: Rect
  duties: Duty[]
  hazards: Hazard[]
}

export type Game = {
  stageIndex: number
  lives: number
  status: Status
  player: Rect & { vx: number; vy: number; facing: -1 | 1 }
  cameraY: number
  frame: number
  crew: Crew[]
  duties: Duty[]
  platforms: Platform[]
  hazards: Hazard[]
  exit: Rect & { ready: boolean }
  prompt: string | null
  notice: string | null
  recruited: AgentId[]
  groundedOn: Platform | null
  coyote: number
  jumpBuffer: number
  jumpHeld: boolean
  useHeld: boolean
  noticeUntil: number
  trail: { x: number; y: number }[]
}

export const AGENT_NAMES: Record<AgentId, string> = {
  codex: "Codex",
  claude: "Claude Code",
  pi: "Pi",
  fx: "Fx",
}

const LABELS: Record<AgentId, string> = {
  codex: "Repair bridge",
  claude: "Hold lift switch",
  pi: "Enter vent",
  fx: "Power shuttle",
}

function surface(x: number, y: number, w: number, kind: PlatformKind = "ledge"): Platform {
  return { x, y, w, h: kind === "floor" ? 20 : 12, kind }
}

function buildStage(
  name: string,
  sections: [AgentId, "left" | "right"][],
  difficulty: number,
): Stage {
  const height = 440 + sections.length * 242
  const floor = surface(30, height - 40, WIDTH - 60, "floor")
  const route = [floor]
  const hazards: Hazard[] = []
  const duties: Duty[] = []
  let y = floor.y
  for (const [agent, side] of sections) {
    const rect = (x: number, width: number) => side === "left" ? x : WIDTH - x - width
    y -= 65 + difficulty * 2
    const approach = surface(rect(62, 108 - difficulty * 8), y, 108 - difficulty * 8)
    const mechanism = {
      codex: surface(rect(109, 154), y - 79, 154, "bridge"),
      claude: surface(rect(162, 70), y, 70, "lift"),
      pi: surface(rect(136, 126), y - 81, 126),
      fx: surface(rect(134, 76), y - 52, 76, "shuttle"),
    }[agent]
    const destX = agent === "fx" ? 258 : agent === "claude" ? 158 : 207
    const destination = surface(rect(destX, 112 - difficulty * 6), y - 168, 112 - difficulty * 6)
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
  const last = route.at(-1)!
  const lastCenter = last.x + last.w / 2
  const middleCenter = lastCenter < WIDTH / 2 ? 293 : 186
  const topCenter = lastCenter < WIDTH / 2 ? 385 : 95
  const middle = surface(middleCenter - 42, y - 77 - difficulty * 4, 84 - difficulty * 7)
  const roof = surface(topCenter - 40, middle.y - 76 - difficulty * 4, 80)
  route.push(middle, roof)
  if (difficulty) {
    hazards.push({ x: 209, y: floor.y - 16, w: 62, h: 16, kind: "spikes", active: true })
  }
  return {
    name,
    height,
    spawn: { x: sections[0][1] === "left" ? 89 : 359, y: floor.y - PLAYER_HEIGHT },
    route,
    exit: { x: topCenter - 17, y: roof.y - 46, w: 34, h: 46 },
    duties,
    hazards,
  }
}

export const STAGES = [
  buildStage("Loading Dock", [["codex", "left"]], 0),
  buildStage("Machine Room", [["claude", "right"]], 1),
  buildStage("Cooling Stack", [["pi", "left"], ["codex", "right"]], 2),
  buildStage("Antenna Deck", [["fx", "right"], ["codex", "left"], ["claude", "right"], ["pi", "left"]], 3),
]

function loadStage(game: Game, stageIndex: number, checkpoint: boolean) {
  const stage = STAGES[stageIndex]
  const completed = checkpoint ? game.duties.filter((duty) => duty.complete).map((duty) => duty.id) : []
  game.stageIndex = stageIndex
  game.hazards = stage.hazards.map((hazard) => ({ ...hazard }))
  game.duties = stage.duties.map((duty) => {
    const complete = completed.includes(duty.id)
    const hazard = game.hazards.find((candidate) => candidate.x === duty.hazard?.x && candidate.y === duty.hazard.y)
    if (hazard) hazard.active = !complete
    return { ...duty, mechanism: { ...duty.mechanism }, hazard, complete }
  })
  game.platforms = [...stage.route, ...game.duties.flatMap((duty) =>
    duty.complete || duty.id === "pi" ? [duty.mechanism] : [],
  )]
  game.exit = { ...stage.exit, ready: game.duties.every((duty) => duty.complete) }
  game.player = { ...stage.spawn, w: PLAYER_WIDTH, h: PLAYER_HEIGHT, vx: 0, vy: 0, facing: 1 }
  game.cameraY = stage.height - VIEW_HEIGHT
  const newcomer = game.duties[0]
  game.crew = game.recruited.map((id, index) => ({
    id,
    x: stage.spawn.x + PLAYER_WIDTH / 2 - (index + 1) * 22,
    y: stage.spawn.y + PLAYER_HEIGHT,
    mode: "following",
  }))
  if (!game.recruited.includes(newcomer.agent)) {
    game.crew.push({ id: newcomer.agent, x: newcomer.x, y: newcomer.y, mode: "waiting" })
  }
  game.groundedOn = stage.route[0]
  game.coyote = 0
  game.jumpBuffer = 0
  game.prompt = null
  game.trail = []
}

export function createGame(): Game {
  const game: Game = {
    stageIndex: 0,
    lives: 3,
    status: "playing",
    player: { x: 0, y: 0, w: PLAYER_WIDTH, h: PLAYER_HEIGHT, vx: 0, vy: 0, facing: 1 },
    cameraY: 0,
    frame: 0,
    crew: [],
    duties: [],
    platforms: [],
    hazards: [],
    exit: { x: 0, y: 0, w: 0, h: 0, ready: false },
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
  game.exit.ready = game.duties.every((item) => item.complete)
}

function advanceDuty(game: Game, duty: Duty) {
  if (duty.active) duty.elapsed++
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
    const phase = (duty.elapsed % 240) / 240
    const progress = clamp((1 - Math.abs(phase * 2 - 1)) * 1.5 - 0.25, 0, 1)
    platform.x = home.x + (farX - home.x) * progress
    platform.y = home.y - 75 * progress
    if (duty.complete) duty.elapsed++
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
  player.x = clamp(player.x + player.vx, 0, WIDTH - player.w)
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

function updateCrew(game: Game) {
  const { player } = game
  game.trail.push({ x: player.x + player.w / 2, y: player.y + player.h })
  if (game.trail.length > 48) game.trail.shift()
  for (const [index, crew] of game.crew.entries()) {
    if (crew.mode === "waiting") {
      if (!near(player, crew.x, crew.y, 27, 26)) continue
      crew.mode = "following"
      game.recruited.push(crew.id)
      game.lives++
      say(game, `${AGENT_NAMES[crew.id]} joined · +1 life`)
    }
    const trail = game.trail[Math.max(0, game.trail.length - 1 - (index + 1) * 10)]
    const duty = crew.mode === "working" ? game.duties.find((item) => item.agent === crew.id) : undefined
    const spacing = (index + 1) * 22
    const facingSpace = player.facing === 1 ? trail.x - 12 : WIDTH - trail.x - 12
    const side = facingSpace >= spacing ? -player.facing : player.facing
    const targetX = duty?.workX ?? clamp(trail.x + spacing * side, 12, WIDTH - 12)
    const targetY = duty?.workY ?? trail.y - 5
    crew.x += (targetX - crew.x) * 0.22
    crew.y += (targetY - crew.y) * 0.22
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
  game.frame++
  if (game.frame >= game.noticeUntil) game.notice = null
  for (const duty of game.duties) advanceDuty(game, duty)
  movePlayer(game, input)
  updateCrew(game)
  const duty = game.duties.find((item) => !item.active && !item.complete &&
    game.recruited.includes(item.agent) && near(game.player, item.x, item.y, 44, 32))
  game.prompt = duty?.label ?? null
  if (duty && input.use && !game.useHeld) {
    duty.active = true
    const crew = game.crew.find((member) => member.id === duty.agent)
    if (crew) crew.mode = "working"
    if (duty.id === "claude" || duty.id === "fx") game.platforms.push(duty.mechanism)
    game.prompt = null
  }
  game.jumpHeld = !!input.jump
  game.useHeld = !!input.use
  const targetY = clamp(game.player.y - VIEW_HEIGHT * 0.50, 0, STAGES[game.stageIndex].height - VIEW_HEIGHT)
  game.cameraY += (targetY - game.cameraY) * 0.13
  if (game.player.y > STAGES[game.stageIndex].height + 22 ||
    game.hazards.some((hazard) => hazard.active && overlaps(game.player, hazard))) {
    loseLife(game)
    return
  }
  if (game.exit.ready && overlaps(game.player, game.exit)) {
    if (game.stageIndex + 1 === STAGES.length) {
      game.status = "won"
      game.notice = null
      game.prompt = null
    } else {
      loadStage(game, game.stageIndex + 1, false)
      say(game, STAGES[game.stageIndex].name)
    }
  }
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
  if (!nextDuty) return "Climb to the exit"
  if (!game.recruited.includes(nextDuty.agent)) return `Reach ${AGENT_NAMES[nextDuty.agent]}`
  return nextDuty.active ? WORK_HINTS[nextDuty.agent] : STATION_HINTS[nextDuty.agent]
}

export function getSnapshot(game: Game) {
  return {
    stageIndex: game.stageIndex,
    stageName: STAGES[game.stageIndex].name,
    lives: game.lives,
    status: game.status,
    prompt: game.prompt,
    hint: getContextHint(game),
    notice: game.notice,
    recruited: [...game.recruited],
  }
}
