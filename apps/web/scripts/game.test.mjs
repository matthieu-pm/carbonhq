import assert from "node:assert/strict"
import test from "node:test"
import { AGENT_NAMES, createGame, getSnapshot, STAGES, stepGame } from "../src/app/game/engine.ts"
import { RunClock } from "../src/app/game/run-clock.ts"

test("finish time counts slow frames, excludes pauses, and keeps partial seconds across resumes", () => {
  const clock = new RunClock()
  clock.start(500)
  for (let now = 700; now <= 10_500; now += 200) {
    assert.equal(clock.seconds(now), Math.floor((now - 500) / 1000))
  }
  clock.pause(11_250)
  clock.pause(13_000)
  assert.equal(clock.seconds(20_000), 10)
  clock.start(20_000)
  clock.start(20_200)
  assert.equal(clock.seconds(20_250), 11)
})

const center = (rect) => rect.x + rect.w / 2
const feet = (game) => game.player.y + game.player.h

function run(game, count, input = {}) {
  for (let i = 0; i < count; i++) stepGame(game, input)
}

function waitUntil(game, condition) {
  for (let i = 0; i < 240 && !condition(); i++) stepGame(game, {})
  assert.ok(condition(), "Timed out waiting for the obstacle")
}

function waitForOpening(game, arc) {
  waitUntil(game, () => arc.active)
  waitUntil(game, () => !arc.active)
}

function jumpTo(game, target, { stop = () => game.groundedOn === target, use = false } = {}) {
  const arc = game.hazards.find((hazard) => hazard.kind === "arc" && hazard.y + hazard.h === target.y)
  if (arc) waitForOpening(game, arc)
  stepGame(game, { use })
  for (let i = 0; i < 65; i++) {
    const offset = center(target) - center(game.player)
    stepGame(game, { left: offset < -3, right: offset > 3, jump: i === 0, use })
    if (i > 4 && stop()) return
  }
  assert.fail(`Missed landing on ${target.kind} (${target.x}, ${target.y}); feet at ${center(game.player)}, ${feet(game)}`)
}

function approachFirstDuty(game, { holdUse = false } = {}) {
  const [duty] = game.duties
  const route = STAGES[game.stageIndex].route
  const approach = route[route.indexOf(duty.destination) - 1]
  for (const target of route.slice(1, route.indexOf(approach) + 1)) {
    jumpTo(game, target, { use: holdUse && target === approach })
  }
  assert.equal(game.prompt, duty.label)
  return duty
}

function crossMachinery(game, duty) {
  assert.equal(game.prompt, duty.label)
  const member = game.crew.find((crew) => crew.id === duty.agent)
  assert.equal(member.mode, "following")
  stepGame(game, { use: true })
  assert.equal(member.mode, "working")
  if (duty.id === "codex" || duty.id === "pi") {
    run(game, 40)
    assert.equal(duty.complete, true)
    jumpTo(game, duty.mechanism)
  } else {
    jumpTo(game, duty.mechanism)
    run(game, 70)
    assert.equal(game.groundedOn, duty.mechanism)
    assert.ok(duty.mechanism.y < duty.y - 100)
  }
  jumpTo(game, duty.destination)
  run(game, 2)
  assert.equal(duty.complete, true)
  assert.equal(member.mode, "following")
}

function walkTo(game, targetX, { stop = () => Math.abs(targetX - center(game.player)) < 3, use = false } = {}) {
  for (let i = 0; i < 90 && !stop(); i++) {
    const offset = targetX - center(game.player)
    stepGame(game, { left: offset < -2, right: offset > 2, use })
  }
  assert.ok(stop(), `Could not reach x=${targetX} from x=${center(game.player)}`)
}

function climbMainRoute(game) {
  const stage = STAGES[game.stageIndex]
  const lives = game.lives
  const hadKey = game.hasKey
  const previousCrew = [...game.recruited]
  for (const target of stage.route.slice(1, -1)) {
    const duty = game.duties.find((duty) => duty.destination === target)
    if (duty) crossMachinery(game, duty)
    else jumpTo(game, target)
    assert.equal(game.lives, lives)
    assert.deepEqual(game.recruited, previousCrew)
  }
  assert.equal(game.hasKey, hadKey)
}

function takeKeycardDetour(game, branch) {
  assert.equal(game.groundedOn, branch.junction)
  for (const ledge of branch.ledges) {
    assert.equal(game.hasKey, false)
    jumpTo(game, ledge)
  }
  assert.equal(getSnapshot(game).hasKey, true)
  for (const ledge of branch.ledges.slice(0, -1).reverse()) jumpTo(game, ledge)
  jumpTo(game, branch.junction)
}

function clearFloor(game) {
  const stageIndex = game.stageIndex
  const stage = STAGES[stageIndex]
  const lives = game.lives
  const previousCrew = [...game.recruited]
  assert.deepEqual(game.crew.filter((member) => member.mode === "following").map((member) => member.id), previousCrew)
  climbMainRoute(game)
  const roof = stage.route.at(-1)
  if (stage.rescue) {
    const { agent, branch, cell } = stage.rescue
    assert.equal(game.crew.find((member) => member.mode === "waiting")?.id, agent)
    takeKeycardDetour(game, branch)
    jumpTo(game, roof)
    walkTo(game, cell.readerX)
    assert.equal(game.exit.ready, false)
    assert.equal(game.prompt, `Free ${AGENT_NAMES[agent]}`)
    assert.deepEqual(game.recruited, previousCrew)
    stepGame(game, { use: true })
    assert.deepEqual(getSnapshot(game).recruited, [...previousCrew, agent])
    assert.equal(game.hasKey, false)
    assert.equal(game.exit.ready, true)
    assert.equal(game.lives, lives + 1)
    walkTo(game, center(stage.exit), { stop: () => game.stageIndex !== stageIndex })
  } else {
    assert.equal(game.crew.some((member) => member.mode === "waiting"), false)
    jumpTo(game, roof)
    walkTo(game, center(stage.exit))
    assert.equal(game.status, "playing")
    assert.equal(game.prompt, "Restore signal")
    stepGame(game, { use: true })
    assert.equal(game.status, "won")
    assert.equal(game.lives, lives)
    assert.deepEqual(game.recruited, previousCrew)
  }
}

test("every floor can be cleared with four keycard detours and the full crew operating the antenna", () => {
  const game = createGame()
  assert.deepEqual(game.recruited, [])
  for (const [stageIndex] of STAGES.entries()) {
    assert.equal(game.stageIndex, stageIndex)
    clearFloor(game)
  }
  assert.equal(game.stageIndex, 4)
  assert.equal(game.status, "won")
  assert.deepEqual(game.recruited, ["codex", "claude", "pi", "fx"])
  assert.equal(game.lives, 7)
  stepGame(game, {})
  assert.equal(game.lives, 7)
})

// Stand with one toe on the edge nearest the destination, then try both an immediate and a late jump.
function assertNoDirectJump(game, from, to) {
  const right = center(to) > center(from)
  for (const delay of [0, 4]) {
    const probe = structuredClone(game)
    const start = probe.platforms.find((platform) => platform.x === from.x && platform.y === from.y)
    const target = probe.platforms.find((platform) => platform.x === to.x && platform.y === to.y)
    assert.ok(start && target)
    probe.groundedOn = start
    probe.player.x = right ? from.x + from.w - 1 : from.x - probe.player.w + 1
    probe.player.y = from.y - probe.player.h
    probe.player.vy = 0
    probe.jumpHeld = false
    run(probe, delay, { right, left: !right })
    for (let i = 0; i < 90; i++) {
      const offset = center(target) - center(probe.player)
      stepGame(probe, { jump: i === 0, left: offset < -2, right: offset > 2 })
      assert.notEqual(probe.groundedOn, target, "A single jump bypassed the keycard detour")
      if (i > 0 && probe.groundedOn) break
    }
  }
}

test("none of the four keycard shelves can be reached directly from the fork or the roof", () => {
  const game = createGame()
  for (const stage of STAGES) {
    if (!stage.rescue) break
    const { branch } = stage.rescue
    const shelf = branch.ledges.at(-1)
    const roof = stage.route.at(-1)
    assertNoDirectJump(game, branch.junction, shelf)
    assertNoDirectJump(game, roof, shelf)
    assertNoDirectJump(game, shelf, roof)
    clearFloor(game)
  }
})

test("use must be pressed in range to repair a bridge", () => {
  const game = createGame()
  clearFloor(game)
  const duty = approachFirstDuty(game, { holdUse: true })
  assert.equal(duty.id, "codex")
  assert.equal(duty.active, false)
  assert.equal(game.platforms.includes(duty.mechanism), false)
  assert.equal(game.exit.ready, false)
  stepGame(game, {})
  stepGame(game, { use: true })
  run(game, 40)
  assert.equal(game.platforms.includes(duty.mechanism), true)
})

function hitSpikes(game) {
  const spikes = game.hazards.find((hazard) => hazard.kind === "spikes")
  game.player.x = center(spikes) - game.player.w / 2
  game.player.y = spikes.y
  stepGame(game, {})
}

test("the antenna requires the crew’s work and remains available after a checkpoint", () => {
  const game = createGame()
  for (let i = 0; i < 4; i++) clearFloor(game)
  const stage = STAGES[game.stageIndex]
  assert.equal(stage.rescue, null)
  assert.equal(game.hasKey, false)

  function standAtConsole() {
    game.player.x = center(stage.exit) - game.player.w / 2
    game.player.y = stage.route.at(-1).y - game.player.h
    stepGame(game, {})
    stepGame(game, { use: true })
  }
  standAtConsole()
  assert.equal(game.status, "playing")
  assert.equal(game.exit.ready, false)
  hitSpikes(game)
  climbMainRoute(game)
  assert.equal(game.exit.ready, true)
  hitSpikes(game)
  assert.equal(game.exit.ready, true)
  assert.equal(game.recruited.length, 4)
  standAtConsole()
  assert.equal(game.status, "won")
  assert.equal(game.lives, 5)
})

test("the keycard cannot unlock a cell while floor machinery still needs a crew member", () => {
  const game = createGame()
  clearFloor(game)
  const ledge = STAGES[game.stageIndex].rescue.branch.ledges.at(-1)
  game.player.x = center(ledge) - game.player.w / 2
  game.player.y = ledge.y - game.player.h
  stepGame(game, {})
  assert.equal(game.hasKey, true)
  const waiting = game.crew.find((member) => member.mode === "waiting")
  const lives = game.lives
  game.player.x = waiting.x - game.player.w / 2
  game.player.y = waiting.y - game.player.h
  run(game, 5, { use: true })
  assert.equal(game.hasKey, true)
  assert.equal(game.stageIndex, 1)
  assert.equal(game.exit.ready, false)
  assert.equal(waiting.mode, "waiting")
  assert.equal(game.lives, lives)
  assert.deepEqual(game.recruited, ["codex"])
})

test("a missed keycard can be reached from the locked cell, and a rescue survives a checkpoint", () => {
  const game = createGame()
  const [stage] = STAGES
  const { branch, cell } = stage.rescue
  climbMainRoute(game)
  jumpTo(game, stage.route.at(-1))
  walkTo(game, cell.readerX)
  stepGame(game, { use: true })
  walkTo(game, center(stage.exit))
  assert.equal(game.stageIndex, 0)
  assert.equal(game.exit.ready, false)
  assert.equal(game.hasKey, false)
  assert.deepEqual(game.recruited, [])

  const inward = Math.sign(center(branch.junction) - center(stage.exit))
  walkTo(game, center(branch.junction) + inward * branch.junction.w / 4)
  waitUntil(game, () => game.groundedOn === branch.junction)
  takeKeycardDetour(game, branch)
  hitSpikes(game)
  assert.equal(game.lives, 2)
  assert.equal(game.hasKey, true)
  climbMainRoute(game)
  jumpTo(game, stage.route.at(-1), { use: true })
  walkTo(game, cell.readerX, { use: true })
  assert.equal(game.recruited.length, 0)
  assert.equal(game.prompt, "Free Codex")
  stepGame(game, {})
  stepGame(game, { use: true })
  assert.equal(game.lives, 3)
  hitSpikes(game)
  assert.equal(game.lives, 2)
  assert.deepEqual(game.recruited, ["codex"])
  assert.equal(game.exit.ready, true)
  assert.equal(game.hasKey, false)
  climbMainRoute(game)
  assert.equal(game.hasKey, false)
  jumpTo(game, stage.route.at(-1), { stop: () => game.stageIndex === 1 || game.groundedOn === stage.route.at(-1) })
  if (game.stageIndex === 0) walkTo(game, center(stage.exit), { stop: () => game.stageIndex === 1 })
  assert.deepEqual(game.recruited, ["codex"])
  assert.equal(game.lives, 2)
})

test("falling off the dock restarts the climb with its reward still available", () => {
  const game = createGame()
  for (let i = 0; i < 120 && game.lives === 3; i++) stepGame(game, { left: true })
  assert.equal(game.lives, 2)
  assert.equal(game.stageIndex, 0)
  assert.deepEqual(game.recruited, [])
  clearFloor(game)
  assert.equal(game.lives, 3)
  assert.deepEqual(game.recruited, ["codex"])
})

test("a dark arc is safe to stand in and gives a warning before it deals damage", () => {
  const game = createGame()
  clearFloor(game)
  const arc = game.hazards.find((hazard) => hazard.kind === "arc")
  const lives = game.lives
  waitForOpening(game, arc)
  assert.equal(arc.charging, false)
  game.player.x = center(arc) - game.player.w / 2
  game.player.y = arc.y + arc.h - game.player.h
  waitUntil(game, () => arc.charging)
  assert.equal(arc.active, false)
  assert.equal(game.lives, lives)
  waitUntil(game, () => game.lives < lives)
  assert.equal(game.lives, lives - 1)
  assert.equal(game.stageIndex, 1)
  assert.deepEqual(game.recruited, ["codex"])
})

test("checkpoints preserve previous unlocks and finished work, and zero lives ends the run", () => {
  const game = createGame()
  clearFloor(game)
  const duty = approachFirstDuty(game)
  stepGame(game, { use: true })
  run(game, 40)
  assert.equal(duty.complete, true)
  const lives = game.lives
  hitSpikes(game)
  assert.equal(game.lives, lives - 1)
  assert.equal(game.stageIndex, 1)
  assert.deepEqual(game.recruited, ["codex"])
  assert.equal(game.duties[0].complete, true)
  assert.equal(game.platforms.includes(game.duties[0].mechanism), true)
  assert.equal(game.crew.find((member) => member.id === "claude").mode, "waiting")
  for (let i = 1; i < lives; i++) hitSpikes(game)
  assert.equal(game.status, "lost")
  assert.equal(game.lives, 0)
  const frame = game.frame
  stepGame(game, { right: true, jump: true })
  assert.equal(game.frame, frame)
})

test("the bridge destination cannot be reached in a single jump from its controls", () => {
  const game = createGame()
  clearFloor(game)
  const duty = approachFirstDuty(game)
  const right = center(duty.destination) > center(game.player)
  for (let i = 0; i < 48; i++) {
    stepGame(game, { right, left: !right, jump: i === 0 })
    assert.ok(feet(game) > duty.destination.y)
  }
  assert.equal(game.exit.ready, false)
})

test("a live fan costs a life and the earned crew returns at the Antenna Deck checkpoint", () => {
  const game = createGame()
  for (let i = 0; i < 3; i++) clearFloor(game)
  const duty = approachFirstDuty(game)
  assert.equal(duty.id, "pi")
  const lives = game.lives
  for (let i = 0; i < 65 && game.lives === lives; i++) {
    const offset = center(duty.mechanism) - center(game.player)
    stepGame(game, { jump: i === 0, right: offset > 3, left: offset < -3 })
  }
  assert.equal(game.lives, lives - 1)
  assert.equal(game.stageIndex, 3)
  assert.equal(game.duties[0].hazard.active, true)
  assert.deepEqual(game.recruited, ["codex", "claude", "pi"])
  assert.equal(game.crew.find((member) => member.id === "fx").mode, "waiting")
  run(game, 90)
  const followers = game.crew.filter((member) => member.mode === "following")
  const positions = [center(game.player), ...followers.map((member) => member.x)].sort((a, b) => a - b)
  assert.ok(positions.slice(1).every((x, i) => x - positions[i] > 10))
  for (const member of followers) assert.equal(member.y, game.groundedOn.y)
})
