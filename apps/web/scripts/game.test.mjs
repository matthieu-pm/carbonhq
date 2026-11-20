import assert from "node:assert/strict"
import test from "node:test"
import { createGame, getSnapshot, STAGES, stepGame } from "../src/app/game/engine.ts"

const center = (rect) => rect.x + rect.w / 2
const feet = (game) => game.player.y + game.player.h

function run(game, count, input = {}) {
  for (let i = 0; i < count; i++) stepGame(game, input)
}

function jumpTo(game, target, stop = () => game.groundedOn === target) {
  stepGame(game, {})
  for (let i = 0; i < 65; i++) {
    const offset = center(target) - center(game.player)
    stepGame(game, { left: offset < -3, right: offset > 3, jump: i === 0 })
    if (i > 4 && stop()) return
  }
  assert.fail(`Missed landing on ${target.kind} (${target.x}, ${target.y}); feet at ${center(game.player)}, ${feet(game)}`)
}

function approachFirstDuty(game) {
  const stage = STAGES[game.stageIndex]
  const duty = game.duties[0]
  jumpTo(game, stage.route[1])
  assert.equal(game.prompt, duty.label)
  return duty
}

function clearFloor(game) {
  const stageIndex = game.stageIndex
  const stage = STAGES[stageIndex]
  const lives = game.lives
  const previousCrew = [...game.recruited]
  const newcomer = stage.duties[0].agent
  assert.deepEqual(game.crew.map((member) => member.id), [...previousCrew, newcomer])
  assert.deepEqual(game.crew.map((member) => member.mode), [...previousCrew.map(() => "following"), "waiting"])
  for (const [index, duty] of game.duties.entries()) {
    jumpTo(game, stage.route[index * 2 + 1])
    assert.equal(game.prompt, duty.label)
    assert.equal(game.lives, lives + 1)
    const member = game.crew.find((crew) => crew.id === duty.agent)
    assert.equal(duty.active, false)
    stepGame(game, { use: true })
    assert.equal(member.mode, "working")
    if (duty.id === "codex" || duty.id === "pi") {
      run(game, 40)
      assert.equal(duty.complete, true)
      jumpTo(game, duty.mechanism)
    } else if (duty.id === "claude") {
      jumpTo(game, duty.mechanism)
      assert.equal(member.mode, "working")
      run(game, 70)
      assert.equal(game.groundedOn, duty.mechanism)
      assert.ok(duty.mechanism.y < duty.y - 100)
    } else {
      jumpTo(game, duty.mechanism)
      assert.equal(member.mode, "working")
      while (duty.mechanism.y > duty.y - 119 && duty.elapsed < 120) stepGame(game, {})
      assert.equal(game.groundedOn, duty.mechanism)
      assert.ok(duty.mechanism.y <= duty.y - 119)
    }
    jumpTo(game, duty.destination)
    run(game, 2)
    assert.equal(duty.complete, true)
    assert.equal(member.mode, "following")
  }
  const snapshot = getSnapshot(game)
  assert.equal(snapshot.stageName, stage.name)
  assert.deepEqual(snapshot.recruited, [...previousCrew, newcomer])
  assert.equal(game.exit.ready, true)
  jumpTo(game, stage.route.at(-2))
  jumpTo(game, stage.route.at(-1), () => game.stageIndex !== stageIndex || game.status === "won")
}

test("every floor can be completed with movement, jumps and explicit crew actions", () => {
  const game = createGame()
  for (const [stageIndex] of STAGES.entries()) {
    assert.equal(game.stageIndex, stageIndex)
    clearFloor(game)
  }
  assert.equal(game.status, "won")
  assert.equal(game.lives, 7)
})

test("recruiting and holding use outside range do not activate a bridge", () => {
  const game = createGame()
  const stage = STAGES[0]
  run(game, 40, { use: true })
  assert.equal(game.lives, 3)
  const target = stage.route[1]
  for (let i = 0; i < 40; i++) {
    const offset = center(target) - center(game.player)
    stepGame(game, { jump: i === 0, use: true, right: offset > 3, left: offset < -3 })
  }
  const [duty] = game.duties
  assert.equal(game.lives, 4)
  assert.equal(game.prompt, duty.label)
  assert.equal(duty.active, false)
  assert.equal(game.platforms.includes(duty.mechanism), false)
  assert.equal(game.exit.ready, false)
  stepGame(game, {})
  stepGame(game, { use: true })
  run(game, 40)
  assert.equal(game.platforms.includes(duty.mechanism), true)
})

test("falling preserves the stage and recruitment reward exactly once", () => {
  const game = createGame()
  approachFirstDuty(game)
  assert.equal(game.lives, 4)
  for (let i = 0; i < 90 && game.lives === 4; i++) stepGame(game, { left: true })
  assert.equal(game.stageIndex, 0)
  assert.equal(game.lives, 3)
  assert.deepEqual(game.recruited, ["codex"])
  approachFirstDuty(game)
  assert.equal(game.lives, 3)
})

test("recruitment and completed work survive a fall, and zero lives stops the game", () => {
  const game = createGame()
  approachFirstDuty(game)
  stepGame(game, { use: true })
  run(game, 40)
  run(game, 65, { left: true })
  assert.equal(game.duties[0].complete, true)
  assert.equal(game.platforms.includes(game.duties[0].mechanism), true)
  for (let i = 0; i < 3; i++) run(game, 75, { left: true })
  assert.equal(game.status, "lost")
  assert.equal(game.lives, 0)
  const frame = game.frame
  stepGame(game, { right: true, jump: true })
  assert.equal(game.frame, frame)
})

test("the bridge destination cannot be reached in a single jump from the recruit", () => {
  const game = createGame()
  const duty = approachFirstDuty(game)
  for (let i = 0; i < 48; i++) {
    stepGame(game, { right: true, jump: i === 0 })
    assert.ok(feet(game) > duty.destination.y)
  }
  assert.equal(game.exit.ready, false)
})

test("crossing an operating fan costs one life and returns to the current floor", () => {
  const game = createGame()
  clearFloor(game)
  clearFloor(game)
  assert.equal(game.stageIndex, 2)
  const duty = approachFirstDuty(game)
  const lives = game.lives
  for (let i = 0; i < 65 && game.lives === lives; i++) {
    const offset = center(duty.mechanism) - center(game.player)
    stepGame(game, { jump: i === 0, right: offset > 3, left: offset < -3 })
  }
  assert.equal(game.lives, lives - 1)
  assert.equal(game.stageIndex, 2)
  assert.equal(game.duties[0].hazard.active, true)
  assert.deepEqual(game.recruited, ["codex", "claude", "pi"])
  assert.ok(game.crew.every((member) => member.mode === "following"))
  approachFirstDuty(game)
  assert.equal(game.lives, lives - 1)
})

test("the whole crew returns at the finale checkpoint and settles into separate positions", () => {
  const game = createGame()
  clearFloor(game)
  clearFloor(game)
  clearFloor(game)
  approachFirstDuty(game)
  assert.equal(game.lives, 7)
  for (let i = 0; i < 100 && game.lives === 7; i++) stepGame(game, { right: true })
  assert.equal(game.stageIndex, 3)
  assert.equal(game.lives, 6)
  assert.deepEqual(game.recruited, ["codex", "claude", "pi", "fx"])
  assert.ok(game.crew.every((member) => member.mode === "following"))
  approachFirstDuty(game)
  run(game, 90)
  const positions = game.crew.map((member) => member.x).sort((a, b) => a - b)
  assert.ok(positions.slice(1).every((x, i) => x - positions[i] > 20))
  assert.equal(game.lives, 6)
})
