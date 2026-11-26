import assert from "node:assert/strict";

// Called only by the isolated loopback design fixture, never a real account.
export async function reviewSettings({
  browser,
  click,
  key,
  waitFor,
  screenshot,
  setFailure,
}) {
  const nav = (id) => click(`.settings-nav [aria-controls=settings-${id}]`);
  const fill = async (selector, value) => {
    await click(selector);
    await browser.evaluate(
      `document.querySelector(${JSON.stringify(selector)}).value=''`,
    );
    await browser.command("Input.insertText", { text: value });
  };
  await nav("account");
  await waitFor(
    "document.querySelector('.account-identity dd')?.textContent.includes('long-fixture-account')",
  );
  assert.equal(
    await browser.evaluate(
      "document.querySelectorAll('.settings-section:not([hidden])').length",
    ),
    1,
  );
  await nav("account");
  await click("#settings-security .quiet-panel > button");
  await waitFor("document.querySelector('.mfa-key')");
  await nav("data");
  await nav("account");
  assert.equal(
    await browser.evaluate("document.querySelector('.mfa-key').textContent"),
    "JBSWY3DPEHPK3PXP",
  );
  await fill("#settings-security input[name=code]", "000000");
  await click("#settings-security form button");
  await waitFor("document.querySelector('#settings-security [role=alert]')");
  await fill("#settings-security input[name=code]", "123456");
  await click("#settings-security form button");
  await waitFor("document.querySelector('.recovery-codes')");
  await nav("team");
  await nav("account");
  assert.match(
    await browser.evaluate(
      "document.querySelector('.recovery-codes').textContent",
    ),
    /fixture-recovery-one/,
  );
  await click("#settings-security .quiet-panel > button");
  await waitFor(
    "document.querySelector('#settings-security input[name=password]')",
  );
  setFailure("/api/account/sessions/end-others");
  await click("#settings-security .quiet-panel + .quiet-panel > button");
  await waitFor(
    "document.querySelector('#settings-security .quiet-panel + .quiet-panel [role=alert]')",
  );
  assert.equal(
    await browser.evaluate(
      "document.querySelectorAll('#settings-security .history-list li').length",
    ),
    2,
  );
  setFailure("");
  await click("#settings-security .quiet-panel + .quiet-panel > button");
  await waitFor(
    "document.querySelectorAll('#settings-security .history-list li').length===1",
  );
  await screenshot("settings-security-desktop");
  await fill("#settings-security input[name=password]", "fixture-password");
  await fill("#settings-security input[name=code]", "123456");
  await click("#settings-security form button");
  await waitFor(
    "!document.querySelector('#settings-security input[name=password]')",
  );

  await nav("team");
  await fill("#settings-team input[type=email]", "helper-fixture@example.test");
  await click("#settings-team form button[type=submit]");
  await waitFor("document.querySelector('#settings-team .support-list li')");
  await click("#settings-team .support-list button");
  await waitFor("!document.querySelector('#settings-team .support-list li')");
  setFailure("/api/team");
  await fill("#settings-team input[type=email]", "helper-fixture@example.test");
  await click("#settings-team form button[type=submit]");
  await waitFor("document.querySelector('#settings-team [role=alert]')");
  setFailure("");

  await nav("data");
  await browser.command("Browser.setDownloadBehavior", { behavior: "deny" });
  await fill("#settings-data form input[name=password]", "fixture-password");
  await click("#settings-data form button");
  await waitFor(
    "document.querySelector('#settings-data [role=status]')?.textContent==='Your export is ready.'",
  );
  assert.equal(
    await browser.evaluate(
      "document.querySelector('#settings-data form input[name=password]').value",
    ),
    "",
  );
  assert.equal(
    await browser.evaluate(
      "!!document.querySelector('#settings-data [role=alert]')",
    ),
    false,
  );
  await click(".settings-danger > button");
  await fill(".settings-danger input[name=password]", "fixture-password");
  await fill(".settings-danger input[name=confirm]", "WRONG");
  assert.equal(
    await browser.evaluate(
      "document.querySelector('.settings-danger input[name=confirm]').checkValidity()",
    ),
    false,
  );
  await fill(".settings-danger input[name=confirm]", "DELETE");
  await click(".settings-danger .danger");
  await waitFor("document.querySelector('#settings-data [role=alert]')");
  await click(".settings-danger button[type=button]");
  await waitFor("!document.querySelector('.settings-danger form')");

  for (const [width, height] of [
    [1440, 900],
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
    for (const section of ["account", "appearance", "team", "data"]) {
      await nav(section);
      assert.equal(
        await browser.evaluate(
          "document.documentElement.scrollWidth<=innerWidth",
        ),
        true,
        `${section} overflows ${width}x${height}`,
      );
    }
    if (width === 320) {
      await nav("account");
      await screenshot("settings-account-phone");
    }
    if (width === 844) {
      await nav("team");
      await screenshot("settings-team-short");
    }
  }
  // Buttons retain normal keyboard behavior; no custom Tab trap in section navigation.
  await browser.evaluate(
    "document.querySelector('.settings-nav button').focus()",
  );
  for (const section of ["appearance", "team"]) {
    await key("Tab");
    assert.equal(
      await browser.evaluate(
        "document.activeElement.getAttribute('aria-controls')",
      ),
      `settings-${section}`,
    );
    await key(" ", "Space");
    await waitFor(`!document.querySelector('#settings-${section}').hidden`);
  }
}
