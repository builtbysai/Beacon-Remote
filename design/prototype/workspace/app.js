/* Beacon Remote — interactive design prototype. No network access or real remote control. */
(() => {
  "use strict";
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const ico = (name) =>
    `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const escapeHTML = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch],
    );
  const DEMO_IP = [
    "203.0.113.28",
    "198.51.100.47",
    "198.51.100.61",
    "203.0.113.19",
    "203.0.113.41",
    "192.0.2.86",
    "198.51.100.25",
    "192.0.2.12",
  ];
  const devices = [
    {
      id: "BR-001-7E2C",
      name: "STUDIO-WS",
      os: "Windows 11 Pro",
      build: "26100.6584",
      group: "Studio",
      status: "online",
      last: "Now",
      local: "10.0.1.24",
      public: DEMO_IP[0],
      agent: "0.3.7-demo",
      access: "Unattended",
      cpu: "8%",
      memory: "11.2 / 64 GB",
      lastSession: "Today, 14:06",
      kind: "desktop",
      fave: true,
    },
    {
      id: "BR-002-AC18",
      name: "ZBOOK-15",
      os: "Windows 11 Pro",
      build: "26100.6584",
      group: "Lab",
      status: "online",
      last: "1 min ago",
      local: "192.168.1.85",
      public: DEMO_IP[1],
      agent: "0.3.7-demo",
      access: "Unattended",
      cpu: "22%",
      memory: "18.6 / 32 GB",
      lastSession: "Yesterday, 21:33",
      kind: "laptop",
      fave: true,
    },
    {
      id: "BR-003-35D0",
      name: "FRONTDESK-02",
      os: "Windows 10 Pro",
      build: "19045.6456",
      group: "Client",
      status: "online",
      last: "2 min ago",
      local: "192.168.4.61",
      public: DEMO_IP[2],
      agent: "0.3.7-demo",
      access: "Attended",
      cpu: "15%",
      memory: "5.4 / 16 GB",
      lastSession: "Yesterday, 13:36",
      kind: "desktop",
      fave: false,
    },
    {
      id: "BR-004-9B7A",
      name: "LATITUDE-3400",
      os: "Windows 10 Pro",
      build: "19045.6456",
      group: "Lab",
      status: "offline",
      last: "Yesterday, 18:42",
      local: "192.168.1.97",
      public: DEMO_IP[3],
      agent: "0.3.5-demo",
      access: "Unattended",
      cpu: "—",
      memory: "—",
      lastSession: "Oct 7, 16:18",
      kind: "laptop",
      fave: false,
    },
    {
      id: "BR-005-C19F",
      name: "SHOP-REGISTER",
      os: "Windows 11 Pro",
      build: "26100.6584",
      group: "Client",
      status: "online",
      last: "5 min ago",
      local: "10.20.0.24",
      public: DEMO_IP[4],
      agent: "0.3.7-demo",
      access: "Attended",
      cpu: "6%",
      memory: "3.8 / 16 GB",
      lastSession: "Oct 7, 11:20",
      kind: "desktop",
      fave: false,
    },
    {
      id: "BR-006-2D11",
      name: "HOME-PC",
      os: "Windows 11 Home",
      build: "26100.6584",
      group: "Personal",
      status: "online",
      last: "Now",
      local: "192.168.1.20",
      public: DEMO_IP[5],
      agent: "0.3.6-demo",
      access: "Unattended",
      cpu: "4%",
      memory: "7.1 / 32 GB",
      lastSession: "Today, 10:31",
      kind: "desktop",
      fave: true,
    },
    {
      id: "BR-007-4DCE",
      name: "LAB-NODE-03",
      os: "Windows 11 Pro",
      build: "26100.6584",
      group: "Lab",
      status: "offline",
      last: "Oct 6, 09:14",
      local: "10.0.1.34",
      public: DEMO_IP[6],
      agent: "0.3.5-demo",
      access: "Unattended",
      cpu: "—",
      memory: "—",
      lastSession: "Oct 4, 12:10",
      kind: "desktop",
      fave: false,
    },
    {
      id: "BR-008-A81B",
      name: "EDIT-SUITE",
      os: "Windows 11 Pro",
      build: "26100.6584",
      group: "Studio",
      status: "online",
      last: "4 min ago",
      local: "10.0.1.32",
      public: DEMO_IP[7],
      agent: "0.3.7-demo",
      access: "Unattended",
      cpu: "29%",
      memory: "16.0 / 64 GB",
      lastSession: "Oct 8, 18:03",
      kind: "desktop",
      fave: false,
    },
  ];
  let events = [
    {
      type: "session",
      label: "Remote session ended",
      device: "STUDIO-WS",
      time: "Today, 14:24",
      detail: "18 min · direct",
    },
    {
      type: "session",
      label: "Remote session started",
      device: "STUDIO-WS",
      time: "Today, 14:06",
      detail: "Control granted",
    },
    {
      type: "device",
      label: "Device connected",
      device: "ZBOOK-15",
      time: "Today, 13:52",
      detail: "Agent 0.3.7-demo",
    },
    {
      type: "security",
      label: "Enrollment approved",
      device: "EDIT-SUITE",
      time: "Oct 8, 18:20",
      detail: "Per-device identity",
    },
    {
      type: "session",
      label: "Remote session ended",
      device: "HOME-PC",
      time: "Today, 10:57",
      detail: "26 min · relayed",
    },
    {
      type: "session",
      label: "Remote session started",
      device: "HOME-PC",
      time: "Today, 10:31",
      detail: "Control granted",
    },
    {
      type: "security",
      label: "Support consent approved",
      device: "FRONTDESK-02",
      time: "Oct 8, 13:36",
      detail: "Attended",
    },
    {
      type: "device",
      label: "Device went offline",
      device: "LATITUDE-3400",
      time: "Oct 8, 18:42",
      detail: "Last heartbeat",
    },
  ];
  const recent = [
    {
      device: "STUDIO-WS",
      date: "Today, 14:06–14:24",
      duration: "18 min",
      route: "Direct",
    },
    {
      device: "HOME-PC",
      date: "Today, 10:31–10:57",
      duration: "26 min",
      route: "Relay",
    },
    {
      device: "FRONTDESK-02",
      date: "Oct 8, 13:36–13:48",
      duration: "12 min",
      route: "Direct",
    },
    {
      device: "EDIT-SUITE",
      date: "Oct 8, 18:03–18:15",
      duration: "12 min",
      route: "Direct",
    },
  ];
  const settingsKey = "beacon-remote-prototype-settings-v1";
  let preferences = {
    viewOnly: false,
    confirm: true,
    stats: true,
    theme: "system",
    density: "comfortable",
    sidebarCollapsed: false,
  };
  try {
    preferences = {
      ...preferences,
      ...JSON.parse(localStorage.getItem(settingsKey) || "{}"),
    };
  } catch (e) {}
  const state = {
    page: "computers",
    filter: "all",
    group: "all",
    search: "",
    selected: "BR-001-7E2C",
    detailTab: "overview",
    sort: "asc",
    favoriteOnly: false,
    session: null,
    drawer: false,
    code: null,
    codeTimer: null,
    display: "1",
    scale: "fit",
    sessionStats: false,
  };
  let modalCloseRestore = null;
  const getSelected = () =>
    devices.find((d) => d.id === state.selected) || devices[0];
  const getDevice = (id) => devices.find((d) => d.id === id);
  const format = (value) => escapeHTML(value);
  function toast(message) {
    const region = $("#toastRegion");
    region.innerHTML = `<div class="toast">${format(message)}</div>`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (region.innerHTML = ""), 3200);
  }
  function savePreferences() {
    try {
      localStorage.setItem(settingsKey, JSON.stringify(preferences));
    } catch (e) {}
  }
  const themeMedia = matchMedia("(prefers-color-scheme: dark)");
  const pop = $("#actionPopover");
  let popAnchor = null,
    popRestore = null;
  function closePopover(restore = false) {
    if (pop.hidden) return;
    pop.hidden = true;
    pop.innerHTML = "";
    if (restore && popRestore?.isConnected) popRestore.focus();
    popAnchor = null;
  }
  function placePopover() {
    if (pop.hidden || !popAnchor?.isConnected) return closePopover();
    const b = popAnchor.getBoundingClientRect();
    const width = pop.getBoundingClientRect().width || 228,
      height = pop.getBoundingClientRect().height || 170;
    const maxX = innerWidth - width - 12;
    const left = Math.max(12, Math.min(maxX, b.right - width));
    const below = b.bottom + 8;
    const top =
      below + height > innerHeight - 10 && b.top - height - 8 >= 8
        ? b.top - height - 8
        : Math.min(below, innerHeight - height - 10);
    pop.style.left = left + "px";
    pop.style.top = Math.max(8, top) + "px";
  }
  function openPopover(anchor, markup) {
    if (!pop.hidden && popAnchor === anchor) {
      closePopover(true);
      return;
    }
    closePopover();
    popAnchor = anchor;
    popRestore = anchor;
    pop.innerHTML = markup;
    pop.hidden = false;
    placePopover();
    pop.querySelector('button,[tabindex="0"]')?.focus({ preventScroll: true });
  }
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (
        !pop.hidden &&
        !pop.contains(e.target) &&
        !popAnchor?.contains(e.target)
      )
        closePopover();
    },
    true,
  );
  window.addEventListener("resize", () => {
    closePopover();
  });
  window.addEventListener(
    "scroll",
    () => {
      if (!pop.hidden) placePopover();
    },
    true,
  );
  function applyAppearance() {
    const theme =
      preferences.theme === "system"
        ? themeMedia.matches
          ? "dark"
          : "light"
        : preferences.theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.density = preferences.density;
    document.documentElement.dataset.sidebar = preferences.sidebarCollapsed
      ? "collapsed"
      : "expanded";
    $("#browserThemeColor").setAttribute(
      "content",
      theme === "dark" ? "#15191f" : "#f3f5f8",
    );
    $$('[name="theme"]').forEach((r) => {
      r.checked = r.value === preferences.theme;
      r.closest(".appearance-choice")?.classList.toggle("active", r.checked);
    });
    $$("[data-density]").forEach((b) => {
      b.classList.toggle("active", b.dataset.density === preferences.density);
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.density === preferences.density),
      );
    });
    const label =
      preferences.theme === "dark"
        ? "Switch to light theme"
        : preferences.theme === "light"
          ? "Use system theme"
          : "Switch to dark theme";
    $("#topTheme").title = label;
    $("#topTheme").setAttribute("aria-label", label);
    $("#topTheme use").setAttribute(
      "href",
      theme === "dark" ? "#i-sun" : "#i-moon",
    );
    $("#sidebarToggle").setAttribute(
      "aria-expanded",
      String(!preferences.sidebarCollapsed),
    );
    $("#sidebarToggle").title = preferences.sidebarCollapsed
      ? "Expand sidebar"
      : "Collapse sidebar";
    $("#sidebarToggle").setAttribute("aria-label", $("#sidebarToggle").title);
  }
  function cycleTheme() {
    const order = ["system", "dark", "light"];
    preferences.theme = order[(order.indexOf(preferences.theme) + 1) % 3];
    savePreferences();
    applyAppearance();
    toast(`Theme: ${preferences.theme}`);
  }
  themeMedia.addEventListener?.("change", () => {
    if (preferences.theme === "system") applyAppearance();
  });
  $$('[name="theme"]').forEach((r) =>
    r.addEventListener("change", () => {
      preferences.theme = r.value;
      savePreferences();
      applyAppearance();
    }),
  );
  $$("[data-density]").forEach((b) =>
    b.addEventListener("click", () => {
      preferences.density = b.dataset.density;
      savePreferences();
      applyAppearance();
    }),
  );
  $("#sidebarToggle").addEventListener("click", () => {
    preferences.sidebarCollapsed = !preferences.sidebarCollapsed;
    savePreferences();
    applyAppearance();
  });
  document.addEventListener("keydown", (e) => {
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey &&
      e.key.toLowerCase() === "b" &&
      !e.target.closest("input,textarea,select,[contenteditable]")
    ) {
      e.preventDefault();
      preferences.sidebarCollapsed = !preferences.sidebarCollapsed;
      savePreferences();
      applyAppearance();
    }
  });
  $$("#desktopNav .nav-item").forEach((b) => {
    const title = b.querySelector("span")?.textContent?.trim();
    if (title) {
      b.title = title;
      b.setAttribute("aria-label", title);
    }
  });

  $("#topTheme").addEventListener("click", cycleTheme);
  applyAppearance();

  function openModal(title, content, actions) {
    modalCloseRestore = document.activeElement;
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = content;
    const root = $("#modalActions");
    root.innerHTML = "";
    actions.forEach((action) => {
      const b = document.createElement("button");
      b.className = `button ${action.kind || "secondary"}`;
      b.textContent = action.label;
      b.addEventListener("click", () => {
        closeModal();
        action.onClick?.();
      });
      root.append(b);
    });
    $("#modalBackdrop").hidden = false;
    $("#modalClose").focus();
  }
  function closeModal() {
    $("#modalBackdrop").hidden = true;
    modalCloseRestore?.focus?.();
  }
  $("#modalClose").addEventListener("click", closeModal);
  $("#modalBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "modalBackdrop") closeModal();
  });
  function hideMore() {
    $("#mobileMoreSheet").hidden = true;
  }
  function navigate(page) {
    if (state.session && !$("#remoteSession").hidden) {
      $("#remoteSession").hidden = true;
      state.drawer = false;
    }
    state.page = page;
    $$(".page").forEach((p) =>
      p.classList.toggle("active", p.id === `page-${page}`),
    );
    $$("[data-nav]").forEach((b) =>
      b.classList.toggle("selected", b.dataset.nav === page),
    );
    $("#mobileMore").classList.toggle(
      "selected",
      page === "setup" || page === "settings",
    );
    const titles = {
      computers: "Computers",
      sessions: "Sessions",
      assist: "Assist",
      activity: "Activity",
      setup: "Downloads",
      settings: "Settings",
    };
    $("#topContext").innerHTML =
      `REMOTE <span class="crumb-sep">/</span> <b>${titles[page]}</b>`;
    if (page === "sessions") renderSessions();
    if (page === "activity") renderActivity();
    if (page === "computers") renderComputers();
    $("#inspector").classList.remove("drawer-open");
    state.drawer = false;
    hideMore();
    closePopover();
  }
  $$("[data-nav]").forEach((b) =>
    b.addEventListener("click", () => navigate(b.dataset.nav)),
  );
  $("#mobileMore").addEventListener(
    "click",
    () => ($("#mobileMoreSheet").hidden = !$("#mobileMoreSheet").hidden),
  );
  $("#infoBtn").addEventListener("click", (e) =>
    openPopover(
      e.currentTarget,
      `<div class="popover-head">Prototype</div><p class="popover-description">All devices, activity and sessions are simulated. No remote agent or backend is connected.</p>`,
    ),
  );
  $("#accountBtn").addEventListener("click", (e) =>
    openPopover(
      e.currentTarget,
      `<div class="popover-head">Personal workspace</div><p class="popover-description">Prototype account · no sign-in</p><div class="menu-divider"></div><button data-menu-action="settings">Settings</button><button data-menu-action="appearance">Appearance</button>`,
    ),
  );
  function renderComputers() {
    const online = devices.filter((d) => d.status === "online").length;
    $("#computersCount").textContent = devices.length;
    $("#countAll").textContent = devices.length;
    $("#countOnline").textContent = online;
    $("#countOffline").textContent = devices.length - online;
    $("#computersSummary").innerHTML =
      `${online} online <span>·</span> ${devices.length - online} offline`;
    $$(".filter").forEach((f) =>
      f.classList.toggle("active", f.dataset.status === state.filter),
    );
    const results = devices
      .filter(
        (d) =>
          (state.filter === "all" || state.filter === d.status) &&
          (state.group === "all" || state.group === d.group) &&
          (!state.favoriteOnly || d.fave) &&
          [d.name, d.os, d.group, d.id, d.local, d.public].some((s) =>
            s.toLowerCase().includes(state.search.toLowerCase()),
          ),
      )
      .sort(
        (a, b) =>
          Number(b.fave) - Number(a.fave) ||
          (state.sort === "asc"
            ? a.name.localeCompare(b.name)
            : b.name.localeCompare(a.name)),
      );
    $("#deviceRows").innerHTML = results
      .map(
        (d) => `
      <div class="device-row ${state.selected === d.id ? "active" : ""}" data-device-row="${d.id}">
        <button class="device-select" data-select="${d.id}" title="Details for ${d.name}" aria-current="${state.selected === d.id ? "true" : "false"}"><span class="machine-icon">${ico(d.kind === "laptop" ? "laptop" : "computer")}</span><span class="machine-text"><strong>${format(d.name)}${d.fave ? '<span class="row-favorite" aria-label="Favorite" title="Favorite">★</span>' : ""}<span class="mobile-status-dot ${d.status}" aria-label="${d.status === "online" ? "Online" : "Offline"}" title="${d.status === "online" ? "Online" : "Offline"}"></span></strong><small>${format(d.os)} <span class="mobile-group-copy">· ${format(d.group)}</span></small></span></button>
        <span class="status-text ${d.status === "online" ? "connected" : ""}"><span class="tiny-dot ${d.status}"></span>${d.status === "online" ? "Online" : "Offline"}</span>
        <span class="seen-at">${format(d.last)}</span><span class="machine-access">${format(d.access)}</span>
        <span class="device-row-actions"><button class="quick-connect" data-quick-connect="${d.id}" title="${d.status === "online" ? "Connect to " + d.name : "Computer is offline"}" aria-label="Remote to ${d.name}" ${d.status !== "online" ? "disabled" : ""}>${ico("monitor")}<span>Connect</span></button><button class="row-menu" data-options="${d.id}" title="Actions for ${d.name}" aria-label="Actions for ${d.name}">${ico("ellipsis")}</button></span>
      </div>`,
      )
      .join("");
    $("#listEmpty").hidden = results.length > 0;
    $("#listShowing").textContent =
      `${results.length} of ${devices.length} computers`;
    $("#favoriteOnly").setAttribute("aria-pressed", String(state.favoriteOnly));
    $("#favoriteOnly").classList.toggle("active", state.favoriteOnly);
    $("#sortBtn").innerHTML =
      `Starred first · ${state.sort === "asc" ? "A–Z" : "Z–A"} ${ico("chevron-down")}`;
    renderInspector();
  }
  function selectDevice(id) {
    state.selected = id;
    state.detailTab = "overview";
    renderComputers();
    if (matchMedia("(max-width:1170px)").matches) {
      $("#inspector").classList.add("drawer-open");
      state.drawer = true;
    }
  }
  $("#deviceRows").addEventListener("click", (e) => {
    const opts = e.target.closest("[data-options]");
    if (opts) {
      e.stopPropagation();
      showOptions(opts.dataset.options, opts);
      return;
    }
    const quick = e.target.closest("[data-quick-connect]");
    if (quick) {
      e.stopPropagation();
      requestConnection(quick.dataset.quickConnect);
      return;
    }
    const target = e.target.closest("[data-select]");
    if (target) {
      selectDevice(target.dataset.select);
      return;
    }
    const row = e.target.closest("[data-device-row]");
    if (row) selectDevice(row.dataset.deviceRow);
  });
  $("#deviceRows").addEventListener("dblclick", (e) => {
    const row = e.target.closest("[data-device-row]");
    if (row && !e.target.closest("button"))
      requestConnection(row.dataset.deviceRow);
  });
  $("#deviceRows").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.ctrlKey) {
      const b = e.target.closest("[data-select]");
      if (b) {
        e.preventDefault();
        requestConnection(b.dataset.select);
      }
    }
  });
  function showOptions(id, anchor) {
    const d = getDevice(id);
    if (!d) return;
    openPopover(
      anchor || document.activeElement,
      `<div class="popover-head">${format(d.name)}</div><button data-menu-action="favorite" data-device="${d.id}">${ico("star")}${d.fave ? "Remove favorite" : "Add to favorites"}</button><button data-menu-action="edit" data-device="${d.id}">${ico("gear")}Edit computer</button><button data-menu-action="copy" data-device="${d.id}">${ico("copy")}Copy machine ID</button><div class="menu-divider"></div><button data-menu-action="remote" data-device="${d.id}" ${d.status !== "online" ? "disabled" : ""}>${ico("monitor")}Remote</button>`,
    );
  }
  function editDevice(id) {
    if (!getDevice(id)) return;
    state.selected = id;
    state.detailTab = "edit";
    renderComputers();
    if (matchMedia("(max-width:1170px)").matches) {
      $("#inspector").classList.add("drawer-open");
      state.drawer = true;
    }
    requestAnimationFrame(() => {
      const el = $("#editDeviceName");
      el?.focus();
      el?.select();
    });
  }
  pop.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-menu-action]");
    if (!b) return;
    const action = b.dataset.menuAction,
      id = b.dataset.device,
      d = id ? getDevice(id) : null;
    closePopover();
    if (action === "favorite" && d) {
      d.fave = !d.fave;
      renderComputers();
      toast(d.fave ? "Added to favorites" : "Removed from favorites");
    }
    if (action === "edit" && d) editDevice(id);
    if (action === "remote" && d) requestConnection(id);
    if (action === "copy" && d) {
      try {
        await navigator.clipboard.writeText(d.id);
        toast("Machine ID copied");
      } catch (_) {
        toast(d.id);
      }
    }
    if (action === "settings") navigate("settings");
    if (action === "appearance") navigate("settings");
    if (action === "keys") toast("Demo shortcut: " + b.dataset.key);
  });
  $("#machineSearch").addEventListener("input", (e) => {
    state.search = e.target.value;
    renderComputers();
  });
  $("#machineSearch").addEventListener("search", (e) => {
    state.search = e.target.value;
    renderComputers();
  });
  $$(".filter").forEach((b) =>
    b.addEventListener("click", () => {
      state.filter = b.dataset.status;
      renderComputers();
    }),
  );
  $("#groupFilter").addEventListener("change", (e) => {
    state.group = e.target.value;
    renderComputers();
  });
  $("#favoriteOnly").addEventListener("click", () => {
    state.favoriteOnly = !state.favoriteOnly;
    renderComputers();
  });
  $("#sortBtn").addEventListener("click", () => {
    state.sort = state.sort === "asc" ? "desc" : "asc";
    renderComputers();
  });
  $("#clearFilters").addEventListener("click", () => {
    state.filter = "all";
    state.group = "all";
    state.favoriteOnly = false;
    state.search = "";
    $("#machineSearch").value = "";
    $("#groupFilter").value = "all";
    renderComputers();
  });
  function renderInspector() {
    const d = getSelected(),
      online = d.status === "online";
    const tabs = ["overview", "connection", "history"];
    let content = "";
    if (state.detailTab === "overview") {
      content = `<div class="detail-group"><h3>DEVICE</h3>${rows([
        ["OS", d.os],
        ["OS build", d.build],
        ["Agent", d.agent],
        ["Machine ID", d.id, true],
        ["Group", d.group],
        ["Access", d.access],
      ])}</div><div class="detail-group"><h3>LAST REPORT</h3>${rows([
        ["Last seen", d.last],
        ["CPU", d.cpu],
        ["Memory", d.memory],
        ["Last session", d.lastSession],
      ])}</div>`;
      if (!online)
        content += `<div class="detail-alert">${ico("info")} The device is offline. Last heartbeat: ${d.last}.</div>`;
    } else if (state.detailTab === "connection") {
      content = `<div class="detail-group"><h3>NETWORK</h3>${rows([
        ["Private IPv4", d.local, true],
        ["Public IPv4", d.public, true],
        ["Signaling", "WSS / TLS 443"],
        ["Preferred path", "Direct WebRTC"],
        ["Fallback", "TURN relay"],
        ["Agent", d.agent],
      ])}</div><p class="inspector-note">Addresses are documentation-only test ranges. Route information is illustrative, not measured.</p>`;
    } else if (state.detailTab === "edit") {
      content = `<div class="inline-editor"><form id="deviceEditForm"><label for="editDeviceName">Computer name</label><input id="editDeviceName" maxlength="36" value="${format(d.name)}" required autocomplete="off"><label for="editDeviceGroup">Group</label><select id="editDeviceGroup">${["Personal", "Studio", "Lab", "Client"].map((g) => `<option ${g === d.group ? "selected" : ""}>${g}</option>`).join("")}</select><div class="editor-actions"><button type="button" class="button secondary" id="cancelEdit">Cancel</button><button type="submit" class="button primary">Save changes</button></div></form></div>`;
    } else {
      const items = events.filter((ev) => ev.device === d.name).slice(0, 5);
      content = `<div class="detail-group"><h3>RECENT EVENTS</h3>${items.length ? items.map((ev) => `<div class="detail-history-row"><strong>${ev.label}</strong><small>${ev.time}</small></div>`).join("") : '<p class="inspector-note">No recent events.</p>'}</div>`;
    }
    $("#inspectorContent").innerHTML =
      `<div class="inspector-top"><div class="inspector-header-line"><span class="inspector-avatar">${ico(d.kind === "laptop" ? "laptop" : "computer")}</span><div class="inspector-actions"><button class="icon-button inspector-edit" data-edit="${d.id}" title="Edit computer" aria-label="Edit ${format(d.name)}">${ico("gear")}</button><button class="star-button ${d.fave ? "active" : ""}" data-favorite="${d.id}" title="${d.fave ? "Remove favorite" : "Add favorite"}" aria-label="Toggle favorite">${ico("star")}</button><button class="icon-button inspector-back" id="closeDrawer" title="Close details" aria-label="Close details">${ico("x")}</button></div></div><h2 class="inspector-name">${format(d.name)}</h2><div class="inspector-machine-id">${format(d.id)}</div><div class="inspector-state ${online ? "" : "offline"}"><span class="tiny-dot ${d.status}"></span><strong>${online ? "Online" : "Offline"}</strong><span>· ${format(d.group)}</span></div><div class="inspector-command"><button class="button primary" data-connect="${d.id}" ${online ? "" : "disabled"}>${ico("monitor")} Remote</button><button class="button secondary" data-view="${d.id}" ${online ? "" : "disabled"}>${ico("eye")} View only</button></div></div><div class="detail-tabs" role="tablist" aria-label="Device information">${(state.detailTab === "edit" ? [...tabs, "edit"] : tabs).map((tab) => `<button class="detail-tab ${state.detailTab === tab ? "active" : ""}" role="tab" aria-selected="${state.detailTab === tab}" data-detail-tab="${tab}">${tab[0].toUpperCase() + tab.slice(1)}</button>`).join("")}</div><div class="detail-body">${content}<div class="detail-more-menu"><button class="link-action" data-options="${d.id}">More actions ···</button></div></div>`;
  }
  function rows(list) {
    return `<dl>${list.map(([k, v, mono]) => `<div class="detail-kv"><dt>${format(k)}</dt><dd class="${mono ? "monospace" : ""}">${format(v)}</dd></div>`).join("")}</dl>`;
  }
  $("#inspector").addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit]");
    if (edit) {
      editDevice(edit.dataset.edit);
      return;
    }
    const cancel = e.target.closest("#cancelEdit");
    if (cancel) {
      state.detailTab = "overview";
      renderInspector();
      return;
    }
    const close = e.target.closest("#closeDrawer");
    if (close) {
      $("#inspector").classList.remove("drawer-open");
      state.drawer = false;
      return;
    }
    const tab = e.target.closest("[data-detail-tab]");
    if (tab) {
      state.detailTab = tab.dataset.detailTab;
      renderInspector();
      return;
    }
    const fav = e.target.closest("[data-favorite]");
    if (fav) {
      const d = getDevice(fav.dataset.favorite);
      d.fave = !d.fave;
      renderInspector();
      toast(d.fave ? "Added to favorites" : "Removed from favorites");
      return;
    }
    const options = e.target.closest("[data-options]");
    if (options) {
      showOptions(options.dataset.options, options);
      return;
    }
    const view = e.target.closest("[data-view]");
    if (view) {
      requestConnection(view.dataset.view, "view");
      return;
    }
    const connect = e.target.closest("[data-connect]");
    if (connect) {
      requestConnection(connect.dataset.connect);
    }
  });
  $("#inspector").addEventListener("submit", (e) => {
    if (e.target.id !== "deviceEditForm") return;
    e.preventDefault();
    const d = getSelected();
    const name = $("#editDeviceName").value.trim();
    if (!name) {
      toast("Computer name is required");
      return;
    }
    const previous = d.name;
    d.name = name;
    d.group = $("#editDeviceGroup").value;
    events.unshift({
      type: "device",
      label: "Computer details edited",
      device: d.name,
      time: "Just now",
      detail: `Previous name: ${previous}`,
    });
    state.detailTab = "overview";
    renderComputers();
    renderActivity();
    toast("Computer updated (demo)");
  });
  function requestConnection(id, mode) {
    const d = getDevice(id);
    if (!d || d.status !== "online") {
      toast("This computer is offline");
      return;
    }
    const desired = mode || (preferences.viewOnly ? "view" : "control");
    if (state.session) {
      if (state.session.device === id) {
        $("#remoteSession").hidden = false;
        syncSessionUI();
        return;
      }
      const previous = getDevice(state.session.device);
      openModal(
        "Switch computers?",
        `<p>End the demo session with <strong>${format(previous.name)}</strong> and open <strong>${format(d.name)}</strong>?</p>`,
        [
          { label: "Cancel" },
          {
            label: "Switch",
            kind: "primary",
            onClick: () => {
              finishSession(true);
              requestConnection(id, mode);
            },
          },
        ],
      );
      return;
    }
    if (d.access === "Attended") {
      openModal(
        "Approval required",
        `<p><strong>${format(d.name)}</strong> requires approval on the remote computer. No real connection can be established in this prototype.</p>`,
        [
          { label: "Cancel" },
          {
            label: "Preview session",
            kind: "primary",
            onClick: () => startSession(d, desired),
          },
        ],
      );
    } else startSession(d, desired);
  }
  function startSession(d, mode) {
    state.session = {
      id: `SIM-${Date.now().toString(16).toUpperCase().slice(-7)}`,
      device: d.id,
      mode,
      startedAt: new Date(),
    };
    state.display = "1";
    state.scale = "fit";
    state.mobileZoom = 100;
    state.pointerMode = "trackpad";
    state.sessionStats = false;
    $("#sessionMachineName").textContent = d.name;
    $("#remoteSession").hidden = false;
    $("#sessionInspector").hidden = true;
    syncSessionUI();
    syncSessionCounters();
    renderSessions();
    $("#remoteViewport").scrollTop = 0;
    $("#remoteViewport").scrollLeft = 0;
    closeViewSheet();
    updateZoom();
  }
  function syncSessionCounters() {
    const active = Boolean(state.session);
    $("#navSessionCount").hidden = !active;
  }
  function syncSessionUI() {
    const s = state.session;
    if (!s) return;
    $("#sessionModeLabel").textContent =
      s.mode === "view" ? "View only" : "Control";
    $("#viewToggleText").textContent =
      s.mode === "view" ? "Enable control" : "View only";
    $("#mobileModeText").textContent =
      s.mode === "view" ? "View only" : "Control";
    $("#viewToggle").classList.toggle("active", s.mode === "view");
    $("#inputHint").hidden = s.mode !== "view";
    $("#displayLabel").textContent = `Display ${state.display}`;
    $("#scaleLabel").textContent =
      state.scale === "fit" ? "Fit" : `${state.scale}%`;
    $("#sessionFootSummary").textContent =
      `Display ${state.display} · ${state.scale === "fit" ? "Fit" : state.scale + "%"}`;
    $("#remoteContent").classList.toggle("actual-size", state.scale === "100");
    $("#remoteContent").classList.toggle("zoomed", state.scale === "125");
    updateZoom();
    $("#inspectorDisplay").textContent =
      state.display === "1" ? "1920 × 1080" : "2560 × 1440";
    $("#fakeExplorer .window-actions").style.opacity =
      state.display === "1" ? "1" : ".8";
    $("#sessionInspector").hidden = !state.sessionStats;
    $("#statsToggle").classList.toggle("active", state.sessionStats);
  }
  function finishSession(silent = false) {
    if (!state.session) return;
    const d = getDevice(state.session.device);
    events.unshift({
      type: "session",
      label: "Demo session ended",
      device: d.name,
      time: "Just now",
      detail: "Prototype only",
    });
    recent.unshift({
      device: d.name,
      date: "Just now",
      duration: "Demo",
      route: "Simulated",
    });
    state.session = null;
    $("#remoteSession").hidden = true;
    closeViewSheet();
    syncSessionCounters();
    renderSessions();
    renderComputers();
    if (!silent) toast("Demo session ended");
  }
  function disconnect() {
    if (preferences.confirm) {
      openModal(
        "Disconnect session?",
        `<p>End the simulated remote session with <strong>${format(getDevice(state.session.device).name)}</strong>?</p>`,
        [
          { label: "Cancel" },
          { label: "Disconnect", kind: "danger", onClick: finishSession },
        ],
      );
    } else finishSession();
  }
  $("#disconnectBtn").addEventListener("click", disconnect);
  $("#sessionBack").addEventListener("click", () => {
    $("#remoteSession").hidden = true;
    navigate("computers");
    toast("Session remains open. Find it in Sessions.");
  });
  $("#statsToggle").addEventListener("click", () => {
    state.sessionStats = !state.sessionStats;
    syncSessionUI();
  });
  $("#closeStats").addEventListener("click", () => {
    state.sessionStats = false;
    syncSessionUI();
  });
  $("#fullscreenBtn").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $("#remoteSession").requestFullscreen();
    } catch (e) {
      toast("Fullscreen unavailable in this browser");
    }
  });
  $("#displayButton").addEventListener("click", () => {
    $("#displayMenu").hidden = !$("#displayMenu").hidden;
    $("#scaleMenu").hidden = true;
  });
  $("#scaleButton").addEventListener("click", () => {
    $("#scaleMenu").hidden = !$("#scaleMenu").hidden;
    $("#displayMenu").hidden = true;
  });
  $$("[data-display]").forEach((b) =>
    b.addEventListener("click", () => {
      state.display = b.dataset.display;
      $("#displayMenu").hidden = true;
      syncSessionUI();
    }),
  );
  $$("[data-scale]").forEach((b) =>
    b.addEventListener("click", () => {
      state.scale = b.dataset.scale;
      $("#scaleMenu").hidden = true;
      syncSessionUI();
    }),
  );
  function toggleMode() {
    state.session.mode = state.session.mode === "view" ? "control" : "view";
    syncSessionUI();
    toast(state.session.mode === "view" ? "View-only mode" : "Control mode");
  }
  $("#viewToggle").addEventListener("click", toggleMode);
  $("#mobileMode").addEventListener("click", toggleMode);
  const viewSheet = $("#sessionViewSheet");
  function closeViewSheet() {
    viewSheet.hidden = true;
    $("#mobileScale").setAttribute("aria-expanded", "false");
  }
  function updateZoom() {
    const slider = $("#viewZoomSlider");
    if (!slider) return;
    const viewport = $("#remoteViewport"),
      content = $("#remoteContent");
    if (window.matchMedia("(max-width:650px)").matches) {
      const fitWidth = Math.max(160, viewport.clientWidth - 24);
      const fitHeight = Math.max(100, viewport.clientHeight - 24);
      const naturalFit = Math.min(fitWidth, (fitHeight * 16) / 9);
      const percent = state.mobileZoom || 100;
      content.style.width = Math.round((naturalFit * percent) / 100) + "px";
      content.style.minWidth = "0";
      content.classList.remove("actual-size", "zoomed");
      slider.value = String(percent);
      $("#viewZoomValue").textContent = percent === 100 ? "Fit" : percent + "%";
      $("#mobileScale").classList.toggle("selected", !viewSheet.hidden);
    } else {
      content.style.width = "";
      content.style.minWidth = "";
    }
  }
  function setZoom(n) {
    state.mobileZoom = Math.max(100, Math.min(300, n));
    updateZoom();
  }
  $("#mobileScale").addEventListener("click", () => {
    viewSheet.hidden = !viewSheet.hidden;
    $("#mobileScale").setAttribute("aria-expanded", String(!viewSheet.hidden));
    updateZoom();
  });
  $("#viewSheetClose").addEventListener("click", closeViewSheet);
  $("#viewZoomSlider").addEventListener("input", (e) =>
    setZoom(Number(e.target.value)),
  );
  $("#viewZoomIn").addEventListener("click", () =>
    setZoom((state.mobileZoom || 100) + 25),
  );
  $("#viewZoomOut").addEventListener("click", () =>
    setZoom((state.mobileZoom || 100) - 25),
  );
  $("#viewFitButton").addEventListener("click", () => setZoom(100));
  $$("[data-pointer]").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.pointerMode = btn.dataset.pointer;
      $$("[data-pointer]").forEach((b) =>
        b.classList.toggle("active", b === btn),
      );
      $("#remoteViewport").dataset.pointerMode = state.pointerMode;
    }),
  );
  window.addEventListener("resize", updateZoom);
  const touchPointers = new Map();
  let pinchBaseline = null,
    panOrigin = null;
  $("#remoteViewport").addEventListener("click", (e) => {
    if (state.session?.mode === "view") return;
    const item = e.target.closest(".file-entry");
    if (item) {
      $$(".file-entry").forEach((i) =>
        i.classList.toggle("demo-selected", i === item),
      );
    }
  });
  $("#remoteViewport").addEventListener("dblclick", (e) => {
    if (state.session?.mode === "view") return;
    const item = e.target.closest(".file-entry");
    if (item) {
      toast("Demo: " + item.innerText.trim().split("\n")[0] + " selected");
    }
  });
  $("#remoteViewport").addEventListener("pointerdown", (e) => {
    if (!window.matchMedia("(max-width:650px)").matches) return;
    touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}
    if (touchPointers.size === 1)
      panOrigin = {
        x: e.clientX,
        y: e.clientY,
        left: $("#remoteViewport").scrollLeft,
        top: $("#remoteViewport").scrollTop,
      };
    if (touchPointers.size === 2) {
      const pts = [...touchPointers.values()];
      pinchBaseline = {
        distance: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        zoom: state.mobileZoom || 100,
      };
    }
  });
  $("#remoteViewport").addEventListener("pointermove", (e) => {
    if (!touchPointers.has(e.pointerId)) return;
    touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchBaseline && touchPointers.size === 2) {
      const pts = [...touchPointers.values()];
      let distance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      setZoom(
        Math.round(
          (pinchBaseline.zoom * distance) /
            Math.max(1, pinchBaseline.distance) /
            25,
        ) * 25,
      );
    } else if (
      panOrigin &&
      state.pointerMode !== "touch" &&
      (state.mobileZoom || 100) > 100 &&
      touchPointers.size === 1
    ) {
      $("#remoteViewport").scrollLeft =
        panOrigin.left + panOrigin.x - e.clientX;
      $("#remoteViewport").scrollTop = panOrigin.top + panOrigin.y - e.clientY;
    }
  });
  const releasePointer = (e) => {
    touchPointers.delete(e.pointerId);
    if (touchPointers.size < 2) pinchBaseline = null;
    if (!touchPointers.size) panOrigin = null;
  };
  $("#remoteViewport").addEventListener("pointerup", releasePointer);
  $("#remoteViewport").addEventListener("pointercancel", releasePointer);
  const showKeys = (anchor) =>
    openPopover(
      anchor,
      `<div class="popover-head">Special keys</div><button data-menu-action="keys" data-key="Ctrl + Alt + Del">Ctrl + Alt + Del</button><button data-menu-action="keys" data-key="Win + L">Win + L</button><button data-menu-action="keys" data-key="Alt + Tab">Alt + Tab</button><span class="menu-footnote">Simulated shortcuts</span>`,
    );
  $("#keysButton").addEventListener("click", (e) => showKeys(e.currentTarget));
  $("#mobileKeys").addEventListener("click", (e) => showKeys(e.currentTarget));
  $("#clipboardButton").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.session.id);
      toast("Demo session ID copied");
    } catch (e) {
      toast(`Session ID: ${state.session.id}`);
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".session-toolbar-combo")) {
      $("#displayMenu").hidden = true;
      $("#scaleMenu").hidden = true;
    }
    if (
      state.drawer &&
      !e.target.closest(".inspector") &&
      !e.target.closest(".device-row") &&
      !e.target.closest(".page-heading")
    ) {
      /* close via explicit close only */
    }
  });
  function renderSessions() {
    const activeCount = state.session ? 1 : 0;
    $("#currentSessionsCount").textContent =
      activeCount + " " + (activeCount === 1 ? "connection" : "connections");
    $("#sessionsList").innerHTML = state.session
      ? (() => {
          const d = getDevice(state.session.device);
          return `<div class="session-list-item"><div class="session-list-item-info"><span class="machine-icon">${ico(d.kind === "laptop" ? "laptop" : "computer")}</span><div><strong>${format(d.name)}</strong><small>Demo · ${state.session.mode === "view" ? "View only" : "Control"} · Started just now</small></div></div><button class="button primary" id="resumeSession">Resume</button></div>`;
        })()
      : `<div class="blank-state">${ico("monitor")}<strong>No active sessions</strong><p>Start a session from Computers.</p></div>`;
    $("#recentSessions").innerHTML = recent
      .slice(0, 5)
      .map(
        (e) =>
          `<div class="history-line"><strong>${format(e.device)} <span>· ${format(e.route)}</span></strong><span>${format(e.date)} · ${format(e.duration)}</span></div>`,
      )
      .join("");
    $("#resumeSession")?.addEventListener("click", () => {
      $("#remoteSession").hidden = false;
      syncSessionUI();
    });
  }
  function renderActivity() {
    const f = $("#eventFilter").value;
    $("#activityList").innerHTML =
      events
        .filter((ev) => f === "all" || f === ev.type)
        .map(
          (ev) =>
            `<div class="activity-line"><strong>${format(ev.label)} <span>· ${format(ev.detail)}</span></strong><span>${format(ev.device)}</span><span>${format(ev.time)}</span></div>`,
        )
        .join("") ||
      '<p class="activity-empty">No events match this filter.</p>';
  }
  $("#eventFilter").addEventListener("change", renderActivity);
  $("#exportLog").addEventListener("click", () => {
    const csv = [
      ["event", "computer", "time", "detail"],
      ...events.map((e) => [e.label, e.device, e.time, e.detail]),
    ]
      .map((r) =>
        r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(","),
      )
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "beacon-remote-demo-activity.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast("Demo activity CSV exported");
  });
  function startCodeTimer() {
    clearInterval(state.codeTimer);
    let seconds = 10 * 60;
    const el = $("#codeExpires");
    const update = () => {
      if (el) {
        el.textContent = `Expires in ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      }
      if (seconds-- <= 0) {
        clearInterval(state.codeTimer);
        state.code = null;
        $("#shareState").innerHTML =
          '<p class="share-empty">Code expired.</p><button class="button secondary" id="createCode">Generate code</button>';
      }
    };
    update();
    state.codeTimer = setInterval(update, 1000);
  }
  $("#shareState").addEventListener("click", async (e) => {
    if (e.target.closest("#createCode")) {
      state.code = String(Math.floor(100000 + Math.random() * 900000));
      const formatted = state.code.slice(0, 3) + " " + state.code.slice(3);
      $("#shareState").innerHTML =
        `<div class="share-code">${formatted}</div><span class="share-details" id="codeExpires">Expires in 10:00</span><div class="share-actions"><button class="button primary" id="copyCode">${ico("copy")} Copy code</button><button class="button secondary" id="stopCode">Revoke code</button></div>`;
      startCodeTimer();
    } else if (e.target.closest("#copyCode")) {
      try {
        await navigator.clipboard.writeText(state.code);
        toast("Demo code copied");
      } catch (err) {
        toast(`Demo code: ${state.code}`);
      }
    } else if (e.target.closest("#stopCode")) {
      clearInterval(state.codeTimer);
      state.code = null;
      $("#shareState").innerHTML =
        '<p class="share-empty">A temporary session needs approval from the person at this computer.</p><button class="button secondary" id="createCode">Generate code</button>';
      toast("Demo code revoked");
    }
  });
  $("#joinForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = $("#joinCode").value.replace(/\D/g, "");
    if (code.length !== 6) {
      $("#joinFeedback").textContent = "Enter six digits.";
      return;
    }
    if (state.code && code === state.code) {
      openModal(
        "Host approval",
        `<p>Approval from the remote computer is required. Preview only; no connection will be made.</p>`,
        [
          { label: "Cancel" },
          {
            label: "Preview approved session",
            kind: "primary",
            onClick: () => startSession(devices[2], "control"),
          },
        ],
      );
    } else {
      $("#joinFeedback").textContent =
        "No matching demo code. Generate one under “Share this computer.”";
    }
  });
  $("#joinCode").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^0-9 ]/g, "").slice(0, 8);
    $("#joinFeedback").textContent =
      "Ask the remote user for their six-digit code.";
  });
  $("#enrollmentResult").addEventListener("click", (e) => {
    if (e.target.closest("#generateEnrollment")) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      $("#enrollmentResult").innerHTML =
        `<div class="enrollment-code"><div><strong>${code.slice(0, 3)} ${code.slice(3)}</strong><small>Sample code · not accepted by an agent</small></div><button class="button secondary compact" id="revokeEnrollment">Revoke</button></div>`;
      toast(
        `Demo pairing code for ${$("#enrollmentGroup").value} · ${$("#enrollmentAccess").value}`,
      );
    } else if (e.target.closest("#revokeEnrollment")) {
      $("#enrollmentResult").innerHTML =
        '<button class="button secondary" id="generateEnrollment">Create pairing code</button>';
      toast("Demo pairing code revoked");
    }
  });
  $("#downloadBtn").addEventListener("click", () => {
    const n = $("#installerFeedback");
    n.hidden = false;
    n.scrollIntoView({
      block: "nearest",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  });
  $("#technicalToggle").addEventListener("click", () => {
    const next = !$("#technicalBody").hidden;
    $("#technicalBody").hidden = next;
    $("#technicalToggle").setAttribute("aria-expanded", String(!next));
  });
  $("#settingViewOnly").checked = preferences.viewOnly;
  $("#settingConfirm").checked = preferences.confirm;
  $("#settingStats").checked = preferences.stats;
  [
    ["settingViewOnly", "viewOnly"],
    ["settingConfirm", "confirm"],
    ["settingStats", "stats"],
  ].forEach(([id, key]) =>
    $("#" + id).addEventListener("change", (e) => {
      preferences[key] = e.target.checked;
      savePreferences();
      toast("Preference saved locally");
    }),
  );
  $("#manageAccount").addEventListener("click", () =>
    toast("Account management needs a connected backend"),
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pop.hidden) {
      closePopover(true);
      e.preventDefault();
      return;
    }
    if (
      e.key.toLowerCase() === "t" &&
      e.altKey &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
    ) {
      e.preventDefault();
      cycleTheme();
    }

    if (e.key === "Tab" && !$("#modalBackdrop").hidden) {
      const focusables = $$(
        "button:not([disabled]),input:not([disabled]),select:not([disabled])",
        $("#modalBackdrop"),
      );
      const first = focusables[0],
        last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    if (e.key === "Escape") {
      if (!viewSheet.hidden) {
        closeViewSheet();
        return;
      }
      if (!$("#modalBackdrop").hidden) {
        closeModal();
        return;
      }
      if (!$("#mobileMoreSheet").hidden) {
        hideMore();
        return;
      }
      if (state.drawer) {
        $("#inspector").classList.remove("drawer-open");
        state.drawer = false;
        return;
      }
      if (!$("#displayMenu").hidden || !$("#scaleMenu").hidden) {
        $("#displayMenu").hidden = true;
        $("#scaleMenu").hidden = true;
        return;
      }
    }
    if (
      e.key === "/" &&
      !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName) &&
      state.page === "computers" &&
      $("#remoteSession").hidden
    ) {
      e.preventDefault();
      $("#machineSearch").focus();
    }
  });
  renderComputers();
  renderSessions();
  renderActivity();
  $("#mobileMoreSheet").hidden = true;
})();
