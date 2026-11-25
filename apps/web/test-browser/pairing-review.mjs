import assert from "node:assert/strict";

export async function reviewPairing({
  browser,
  click,
  key,
  waitFor,
  screenshot,
  origin,
  setMode,
  releaseCreate,
  releaseStatus,
  fixture,
}) {
  async function waitFixture(predicate) {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (predicate(fixture())) return;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error("Pairing fixture did not reach the expected state");
  }
  await browser.goto(`${origin}/#computers`);
  await browser.evaluate(
    "Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.fixtureClipboard=value}}})",
  );
  await click(".heading > button");
  await waitFor(
    "document.querySelector('.pairing-code-row [aria-label]')?.textContent.length===32",
  );
  assert.equal(
    await browser.evaluate("document.activeElement.id"),
    "pairing-title",
  );
  await click(".pairing-field:has([aria-label='Pairing code']) button");
  assert.equal(
    await browser.evaluate("window.fixtureClipboard"),
    await browser.evaluate(
      "document.querySelector('[aria-label=\"Pairing code\"]').textContent",
    ),
  );
  for (const [width, height] of [
    [1440, 900],
    [1920, 1080],
    [1024, 600],
    [768, 600],
    [390, 640],
    [320, 480],
    [844, 390],
    [640, 240],
  ]) {
    await browser.command("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    assert.equal(
      await browser.evaluate(
        "document.documentElement.scrollWidth<=innerWidth",
      ),
      true,
      `Pairing overflow ${width}x${height}`,
    );
    await click(".pairing-heading h2");
    if (width === 1440 || width === 320)
      await screenshot(`pairing-waiting-${width}`);
  }
  setMode("cancel-error");
  await click(".pairing-heading button");
  await waitFor(
    "document.querySelector('.pairing-panel [role=alert]')?.textContent.includes('Couldn’t cancel')",
  );
  assert.equal(
    await browser.evaluate(
      "!!document.querySelector('[aria-label=\"Pairing code\"]')",
    ),
    true,
  );
  setMode("waiting");
  await click(".pairing-heading button");
  await waitFor("!document.querySelector('.pairing-panel')");
  setMode("unavailable");
  await click(".heading > button");
  await waitFor(
    "document.querySelector('.pairing-panel [role=status]')?.textContent==='This code is no longer available.'",
  );
  assert.equal(
    await browser.evaluate(
      "!!document.querySelector('[aria-label=\"Pairing code\"]')",
    ),
    false,
  );
  await click(".pairing-heading button");
  await waitFor("!document.querySelector('.pairing-panel')");
  setMode("waiting");
  await waitFor(
    "document.activeElement===document.querySelector('.heading > button')",
  );

  setMode("expired");
  await click(".heading > button");
  await waitFor(
    "document.querySelector('.pairing-panel [role=status]')?.textContent==='This code expired.'",
  );
  assert.equal(
    await browser.evaluate(
      "!!document.querySelector('[aria-label=\"Pairing code\"]')",
    ),
    false,
  );
  setMode("hold-status");
  await click(".pairing-panel > button");
  await waitFixture((state) => state.heldStatuses > 0);
  setMode("claim-on-cancel");
  await click(".pairing-heading button");
  await waitFor(
    "document.querySelector('#pairing-title')?.textContent==='Computer paired'",
  );
  releaseStatus();
  await new Promise((done) => setTimeout(done, 150));
  assert.equal(
    await browser.evaluate(
      "document.querySelector('#pairing-title').textContent",
    ),
    "Computer paired",
  );
  await waitFor(
    "document.querySelector('.device-name')?.textContent.includes('New fixture computer')",
  );
  await screenshot("pairing-completed");
  await click(".pairing-heading button");
  await waitFor("!document.querySelector('.pairing-panel')");

  setMode("late-create");
  const before = fixture().pairingCancels;
  await click(".heading > button");
  await waitFixture((state) => state.heldCreates > 0);
  await click(".pairing-heading button");
  await waitFor("!document.querySelector('.pairing-panel')");
  setMode("waiting");
  releaseCreate();
  await waitFixture((state) => state.pairingCancels > before);
  assert.equal(
    await browser.evaluate("!!document.querySelector('.pairing-panel')"),
    false,
  );

  setMode("status-error");
  await click(".heading > button");
  await waitFor(
    "document.querySelector('.pairing-panel [role=alert]')?.textContent.includes('Couldn’t check pairing')",
  );
  setMode("waiting");
  await waitFor("!document.querySelector('.pairing-panel [role=alert]')");
  await browser.evaluate(
    "document.querySelector('.pairing-heading button').focus()",
  );
  await key(" ", "Space");
  await waitFor("!document.querySelector('.pairing-panel')");
}
