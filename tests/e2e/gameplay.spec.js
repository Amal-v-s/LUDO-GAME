const {test, expect} = require('@playwright/test');

async function enterName(page, name) {
  await page.goto('/');
  await page.locator('#player-name').fill(name);
}

test('two independent browsers create, join and synchronize a complete turn', async ({browser}) => {
  const hostContext = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const guestContext = await browser.newContext({viewport: {width: 1280, height: 900}});
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await enterName(host, 'Host');
    await host.locator('#create-btn').click();
    await expect(host.locator('#waiting')).toBeVisible();
    const code = (await host.locator('#invite-code').textContent()).trim();

    await enterName(guest, 'Guest');
    await guest.locator('#room-code').fill(code);
    await guest.locator('#join-btn').click();
    await expect(guest.locator('#waiting')).toBeVisible();
    await expect(host.locator('#player-total')).toHaveText('2 / 6');
    await host.locator('#start-btn').click();
    await expect(host.locator('#game')).toBeVisible();
    await expect(guest.locator('#game')).toBeVisible();

    const board = host.locator('#board');
    await expect(board.locator('.cell')).toHaveCount(225);
    await expect(board.locator('.track')).toHaveCount(52);
    await expect(board.locator('.safe')).toHaveCount(8);
    await expect(board.locator('.base')).toHaveCount(4);
    await expect(board.locator('.home-path')).toHaveCount(24);
    await expect(board.locator('.center')).toBeVisible();
    await expect(host.locator('#ko-list .ko-row')).toHaveCount(2);
    await expect.poll(() => host.locator('#turn-card').evaluate(card => card.style.getPropertyValue('--turn-color'))).toBe('#ef2938');
    await expect(host.locator('#ko-count')).toHaveCount(0); // Counter is per player and starts at zero.
    await expect(host.locator('.ko-count').first()).toHaveText('0');
    await expect(host.locator('#board .base .token')).toHaveCount(16);
    await expect(guest.locator('#roll-btn')).toBeDisabled();
    await expect(guest.locator('#board .token').first()).toBeDisabled();
    const startingCells = [
      ['6,1', 'rgb(239, 41, 56)'], ['1,8', 'rgb(10, 163, 84)'],
      ['8,13', 'rgb(240, 195, 38)'], ['13,6', 'rgb(38, 159, 223)']
    ];
    for (const [coordinate, expected] of startingCells) {
      await expect(board.locator(`.cell[data-board-cell="${coordinate}"]`)).toHaveCSS('background-color', expected);
    }
    const arrowBackground = await board.locator('.home-path[data-arrow]').first().evaluate(cell => getComputedStyle(cell).backgroundColor);
    expect(arrowBackground).toBe('rgb(255, 255, 255)');

    await host.locator('#roll-btn').click();
    await expect(host.locator('#die')).toHaveAttribute('data-value', '6', {timeout: 5000});
    await expect(host.locator('#die .die-dot.pip-on')).toHaveCount(6);
    await expect(host.locator('#board .token.selectable')).toHaveCount(4);
    await host.locator('#board .base .token.selectable').first().click();
    await expect.poll(async () => host.locator('#board .cell[data-board-cell="6,1"] .token[data-token="0"]').count()).toBe(1);
    await expect.poll(async () => guest.locator('#board .cell[data-board-cell="6,1"] .token[data-token="0"]').count()).toBe(1);

    await expect(host.locator('#roll-btn')).toBeEnabled({timeout: 8000});
    await host.locator('#roll-btn').click();
    await expect(host.locator('#die')).toHaveAttribute('data-value', '2', {timeout: 5000});
    await expect(host.locator('#move-hint')).toContainText('Moved automatically', {timeout: 8000});
    await expect(host.locator('#turn-name')).toHaveText('Guest');
    await expect(guest.locator('#turn-name')).toHaveText('Your turn');
    await expect.poll(() => host.locator('#turn-card').evaluate(card => card.style.getPropertyValue('--turn-color'))).toBe('#0aa354');
    await expect(host.locator('#roll-btn')).toBeDisabled();
    await expect(host.locator('#board .token').first()).toBeDisabled();
    await guest.locator('#roll-btn').click();
    await expect(guest.locator('#die')).toHaveAttribute('data-value', '1', {timeout: 5000});
    await expect(guest.locator('#move-hint')).toContainText('No moves available', {timeout: 8000});
    await expect(host.locator('#turn-name')).toHaveText('Your turn');
    await expect(guest.locator('#turn-name')).toHaveText('Host');
    await expect.poll(() => guest.locator('#turn-card').evaluate(card => card.style.getPropertyValue('--turn-color'))).toBe('#ef2938');

    await host.locator('#fullscreen-toggle').evaluate(button => button.click());
    await expect(host.locator('#fullscreen-toggle')).toHaveAttribute('aria-pressed', 'true');
    await host.locator('#fullscreen-toggle').evaluate(button => button.click());
    await expect(host.locator('#fullscreen-toggle')).toHaveAttribute('aria-pressed', 'false');

    await host.reload();
    await expect(host.locator('#game')).toBeVisible();
    await expect(host.locator('#board .track')).toHaveCount(52);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test('camera access is requested by the player, review can be retaken, and avatar is shared on tokens', async ({browser}) => {
  const context = await browser.newContext({permissions: ['camera'], viewport: {width: 1280, height: 900}});
  const guestContext = await browser.newContext({viewport: {width: 1280, height: 900}});
  const page = await context.newPage();
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d');
    context.fillStyle = '#e62942'; context.fillRect(0, 0, 320, 240);
    const stream = canvas.captureStream(1);
    const videoTrack = stream.getVideoTracks()[0];
    videoTrack.getSettings = () => ({facingMode: 'user', deviceId: 'fake-front'});
    Object.defineProperty(navigator, 'mediaDevices', {configurable: true, value: {
      getUserMedia: async () => stream,
      enumerateDevices: async () => [
        {kind: 'videoinput', deviceId: 'fake-front'}, {kind: 'videoinput', deviceId: 'fake-back'}
      ]
    }});
  });
  try {
    await enterName(page, 'Photo player');
    await expect(page.locator('#camera-modal')).not.toHaveClass(/open/);
    await page.locator('#take-photo-btn').click();
    await expect(page.locator('#camera-modal')).toHaveClass(/open/);
    await expect(page.locator('#switch-camera')).toBeVisible();
    await expect(page.locator('#camera-video')).toHaveClass(/selfie/);
    await page.locator('#capture-photo').click();
    await expect(page.locator('#camera-review')).toBeVisible();
    await expect(page.locator('#captured-photo')).toHaveAttribute('src', /^data:image\//);
    await page.locator('#retake-photo').click();
    await expect(page.locator('#camera-live')).toBeVisible();
    await page.locator('#capture-photo').click();
    await expect(page.locator('#camera-review')).toBeVisible();
    await page.locator('#use-photo').click();
    await expect(page.locator('#avatar-preview img')).toBeVisible();
    await page.locator('#create-btn').click();
    await expect(page.locator('#waiting')).toBeVisible();
    const code = (await page.locator('#invite-code').textContent()).trim();
    const guest = await guestContext.newPage();
    await enterName(guest, 'Avatar guest');
    await guest.locator('#room-code').fill(code);
    await guest.locator('#join-btn').click();
    await expect(page.locator('#player-total')).toHaveText('2 / 6');
    await page.locator('#start-btn').click();
    await expect(page.locator('#board .base .token.has-avatar')).toHaveCount(4);
    await expect(guest.locator('#board .base .token.has-avatar')).toHaveCount(4);
    await expect(guest.locator('#board .token-avatar').first()).toHaveAttribute('src', /^data:image\//);
  } finally {
    await context.close();
    await guestContext.close();
  }
});

test('missing camera devices leave the default avatar usable', async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', {configurable: true, value: {
    getUserMedia: async () => { const error = new Error('no devices'); error.name = 'NotFoundError'; throw error; },
    enumerateDevices: async () => []
  }}));
  await enterName(page, 'No device');
  await page.locator('#take-photo-btn').click();
  await expect(page.locator('#camera-status')).toContainText('No camera was found');
  await page.locator('#cancel-camera').click();
  await page.locator('#create-btn').click();
  await expect(page.locator('#waiting')).toBeVisible();
});

test('camera permission denial gives a fallback and does not block room creation', async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', {configurable: true, value: {
    getUserMedia: async () => { const error = new Error('denied'); error.name = 'NotAllowedError'; throw error; },
    enumerateDevices: async () => []
  }}));
  await enterName(page, 'No camera');
  await page.locator('#take-photo-btn').click();
  await expect(page.locator('#camera-status')).toContainText('permission was denied');
  await page.locator('#cancel-camera').click();
  await page.locator('#create-btn').click();
  await expect(page.locator('#waiting')).toBeVisible();
  await expect(page.locator('#avatar-preview img')).toHaveCount(0);
});

test('mobile layout keeps the board and side panels within the viewport width', async ({browser}) => {
  const hostContext = await browser.newContext({viewport: {width: 390, height: 844}});
  const guestContext = await browser.newContext({viewport: {width: 390, height: 844}});
  const page = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
  await page.setViewportSize({width: 390, height: 844});
  await enterName(page, 'Mobile host');
  await page.locator('#create-btn').click();
  await expect(page.locator('#waiting')).toBeVisible();
  const code = (await page.locator('#invite-code').textContent()).trim();
  await enterName(guest, 'Mobile guest');
  await guest.locator('#room-code').fill(code);
  await guest.locator('#join-btn').click();
  await expect(guest.locator('#waiting')).toBeVisible();
  await expect(page.locator('#player-total')).toHaveText('2 / 6');
  await page.locator('#start-btn').click();
  await expect(page.locator('#game')).toBeVisible();
  const sizes = await page.evaluate(() => ({scroll: document.documentElement.scrollWidth, width: innerWidth}));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width);
  const board = await page.locator('#board').boundingBox();
  expect(board.width).toBeLessThanOrEqual(390);
  await page.locator('#new-room-btn').click();
  await expect(page.locator('#lobby')).toBeVisible();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
