// Apply before styles and React load, including when storage is blocked.
try {
  var appearance = localStorage.getItem("beacon-remote-appearance");
} catch {
  // Browser policy can make even reading localStorage throw.
}
document.documentElement.dataset.theme =
  appearance === "light" || appearance === "dark"
    ? appearance
    : matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
