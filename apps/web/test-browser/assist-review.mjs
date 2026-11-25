import assert from "node:assert/strict";

export async function reviewAssist({
  browser,
  click,
  waitFor,
  screenshot,
  origin,
  setSharedFailure,
  release,
  fixture,
}) {
  await browser.command("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  async function waitFixture(predicate) {
    for (let i = 0; i < 60; i++) {
      if (predicate(fixture())) return;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error("Assist fixture did not reach the expected state");
  }
  const fillCode = async () => {
    await click(".assist-page .assist-code input");
    await browser.command("Input.insertText", { text: "ABCD-EFGH" });
  };
  setSharedFailure(true);
  await browser.goto(`${origin}/#assist`);
  await waitFor(
    "document.querySelector('.assist-page [role=alert]')?.textContent.includes('shared computers')",
  );
  setSharedFailure(false);
  await click(".assist-page [role=alert] button");
  await waitFor(
    "document.querySelector('.assist-page .support-actions button')",
  );
  await fillCode();
  await click(".assist-page form.assist-panel-body button[type=submit]");
  await waitFixture((state) => state.pending === 1);
  assert.equal(
    await browser.evaluate(
      "document.querySelector('.support-queue .support-actions button').disabled",
    ),
    true,
  );
  assert.equal(
    await browser.evaluate(
      "Array.from(document.querySelectorAll('.assist-page .support-actions button')).filter(el=>el.textContent.trim()==='View').every(el=>el.disabled)",
    ),
    true,
  );
  await browser.goto(`${origin}/#settings`);
  release();
  await waitFixture((state) => state.stops === 1);
  assert.equal(
    await browser.evaluate("!!document.querySelector('.live-view')"),
    false,
  );

  await browser.goto(`${origin}/#assist`);
  await waitFor(
    "document.querySelector('.assist-page .support-actions button')",
  );
  await click(
    ".assist-layout > section:not(.support-queue) .support-actions button",
  );
  await waitFixture((state) => state.pending === 1);
  // Fixture logout deliberately fails: the mounted page must still discard
  // the older request made before the explicit sign-out attempt.
  await click(".account-trigger");
  await click(".workspace-signout");
  await waitFor(
    "document.querySelector('.app-shell > .error')?.textContent.includes('Could not sign out')",
  );
  release();
  await waitFixture((state) => state.stops === 2);
  assert.equal(
    await browser.evaluate("!!document.querySelector('.live-view')"),
    false,
  );
  await browser.command("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await screenshot("assist-desktop");

  await browser.goto(`${origin}/#home`);
  await browser.goto(`${origin}/#assist`);
  await waitFor(
    "document.querySelector('.support-queue .support-actions button')",
  );
  await click(".support-queue .support-actions button");
  await waitFixture((state) => state.pending === 1);
  await browser.goto(`${origin}/#activity`);
  release();
  await waitFixture((state) => state.stops === 3);

  await browser.goto(`${origin}/#support`);
  await click(".public-section .assist-code input");
  await browser.command("Input.insertText", { text: "ABCD-EFGH" });
  await click(".public-section form button[type=submit]");
  await waitFixture((state) => state.pending === 1);
  await browser.goto(`${origin}/#security`);
  release();
  await waitFixture((state) => state.stops === 4);
  assert.equal(
    await browser.evaluate("!!document.querySelector('.live-view')"),
    false,
  );
  assert.equal(
    await browser.evaluate(
      "document.body.innerText.includes('Email password recovery, a signed installer')",
    ),
    false,
  );
  for (const [width, height] of [
    [1440, 900],
    [320, 480],
    [844, 390],
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
    );
    if (width === 320) await screenshot("security-phone");
  }
}
