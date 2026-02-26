import { setupLaunchd, uninstallLaunchd } from "../plist.js";

function requireMacOS(): void {
  if (process.platform !== "darwin") {
    throw new Error(
      "Scheduling is only supported on macOS (launchd). Use cron or systemd on Linux.",
    );
  }
}

export function schedule(): void {
  requireMacOS();
  setupLaunchd();
}

export function unschedule(): void {
  requireMacOS();
  uninstallLaunchd();
}
