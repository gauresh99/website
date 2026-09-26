import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG, OUTCOME } from '../js/game/config.js';
import { createParticles, createTrail, P_CONFETTI } from '../js/game/particles.js';
import { createWorld, launch, simulateToSettle, sweptBox } from '../js/game/physics.js';
import { createRng, hashString } from '../js/game/rng.js';
import { createTargets, firstStanding, hitTest, resetTargets, standingCount } from '../js/game/targets.js';

test('targets: generated panels stay inside the goal and reset in O(n)', () => {
  const targets = createTargets(CONFIG.ROUNDS_MAX);
  assert.equal(targets.length, CONFIG.ROUNDS_MAX);

  for (const target of targets) {
    assert.ok(target.cx - target.hw >= -CONFIG.GOAL_HALF_W, 'panel crosses left post');
    assert.ok(target.cx + target.hw <= CONFIG.GOAL_HALF_W, 'panel crosses right post');
    assert.ok(target.cy - target.hh >= 0, 'panel crosses ground');
    assert.ok(target.cy + target.hh <= CONFIG.GOAL_H, 'panel crosses crossbar');
  }

  assert.equal(standingCount(targets), targets.length);
  const hit = hitTest(targets, targets[0].cx, targets[0].cy, CONFIG.BALL_R);
  assert.equal(hit, 0);
  targets[0].down = true;
  assert.notEqual(hitTest(targets, targets[0].cx, targets[0].cy, CONFIG.BALL_R), 0);
  assert.equal(firstStanding(targets), 1);

  resetTargets(targets);
  assert.equal(firstStanding(targets), 0);
  assert.equal(standingCount(targets), targets.length);
});

test('particles: pool has a hard cap and clears without reallocating', () => {
  const rng = createRng(hashString('particle-cap'));
  const particles = createParticles(4);

  particles.burst(0, 1, 0, 20, P_CONFETTI, rng, 20);
  assert.equal(particles.count, 4);
  assert.equal(particles.cap, 4);

  for (let i = 0; i < 180; i++) particles.step(CONFIG.DT, 0);
  assert.equal(particles.count, 0);

  particles.burst(0, 1, 0, 2, P_CONFETTI, rng, 2);
  assert.equal(particles.count, 2);
  particles.clear();
  assert.equal(particles.count, 0);
});

test('trail: ring buffer keeps only the recent fixed-size history', () => {
  const trail = createTrail(3);
  trail.push(1, 10, 100);
  trail.push(2, 20, 200);
  trail.push(3, 30, 300);
  trail.push(4, 40, 400);

  assert.equal(trail.count, 3);
  assert.equal(trail.head, 1);
  assert.deepEqual(Array.from(trail.tx), [4, 2, 3]);
  assert.deepEqual(Array.from(trail.ty), [40, 20, 30]);
  assert.deepEqual(Array.from(trail.tz), [400, 200, 300]);

  trail.clear();
  assert.equal(trail.count, 0);
  assert.equal(trail.head, 0);
});

test('physics: swept collision catches a fast segment through a box', () => {
  const hit = sweptBox(
    -10, 1, 0,
    10, 1, 0,
    0, 1, 0,
    0.5, 0.5, 0.5,
  );
  assert.ok(hit >= 0 && hit <= 1, `expected hit in [0, 1], got ${hit}`);

  const miss = sweptBox(
    -10, 3, 0,
    10, 3, 0,
    0, 1, 0,
    0.5, 0.5, 0.5,
  );
  assert.equal(miss, -1);
});

test('physics: representative shots always settle inside the synchronous cap', () => {
  const rng = createRng(hashString('settle-sweep'));
  const aims = [
    [-2.7, 0.55],
    [0, 1.1],
    [2.7, 1.9],
    [-3.3, 2.2],
    [3.3, 0.35],
  ];
  const powers = [0.2, 0.55, 0.9];

  for (const [x, y] of aims) {
    for (const power of powers) {
      const world = createWorld();
      rng.seed(hashString(`${x}:${y}:${power}`));
      launch(world, x, y, power, 0, rng);
      const steps = simulateToSettle(world, rng, 900);

      assert.ok(steps > 0 && steps <= 900, `settled in invalid step count ${steps}`);
      assert.equal(world.settled, true);
      assert.notEqual(world.outcome, OUTCOME.PENDING);
      for (const value of [world.bx, world.by, world.bz, world.vx, world.vy, world.vz]) {
        assert.equal(Number.isFinite(value), true);
      }
    }
  }
});
