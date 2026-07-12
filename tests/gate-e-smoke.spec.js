// GATE E — E2E smoke over the built site (vite preview). Zero console
// errors, live WebGL, a screenshot of every level, FPS > 30.
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:4173/flop/';
const LEVELS = ['hub', 'construction', 'docks', 'castle'];

for (const level of LEVELS) {
  test(`level ${level} renders clean`, async ({ page }) => {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.goto(`${BASE}?level=${level}`);
    await page.waitForSelector('#m-solo', { timeout: 15000 });
    await page.evaluate(() => document.getElementById('m-solo').click());
    await page.waitForTimeout(3500); // level build + textures + a KO's worth of physics

    const canvasAlive = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return false;
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      return !!gl && !gl.isContextLost();
    });
    expect(canvasAlive, 'WebGL context alive').toBe(true);

    const fps = await page.evaluate(() => new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - start < 2000) requestAnimationFrame(tick);
        else resolve(frames / ((performance.now() - start) / 1000));
      };
      requestAnimationFrame(tick);
    }));
    expect(fps, `fps on ${level}`).toBeGreaterThan(30);

    const player = await page.evaluate(() => {
      const g = window.__flop;
      const p = g?.world?.sim.players[0]?.ragdoll.bodies.pelvis.translation();
      return p ? { y: p.y, mode: g.mode } : null;
    });
    expect(player, 'player exists').not.toBeNull();
    expect(player.mode).toBe('solo');
    expect(player.y, 'ragdoll not through the floor').toBeGreaterThan(-2);

    await page.screenshot({ path: `test-results/level-${level}.png` });
    expect(errors, `console errors on ${level}: ${errors.join(' | ')}`).toHaveLength(0);
  });
}

test('menu renders and lobby UI exists', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto(BASE);
  await expect(page.locator('#m-host')).toBeVisible();
  await expect(page.locator('#m-code')).toBeVisible();
  await page.screenshot({ path: 'test-results/menu.png' });
  expect(errors).toHaveLength(0);
});
