// PoC entry point. Demonstrates the real Lampa plugin bootstrap shape
// (IIFE + singleton guard + appready wait) while pulling in TS modules so the
// build proves that modular TS collapses into one ES5 IIFE.
//
// This is NOT the full plugin yet — it wires just enough (buildPayload) to keep
// the modules in the bundle and confirm the toolchain end-to-end.

import { PLUGIN_ID, VERSION } from "./config";
import { buildPayload } from "./payload-builder";
import type { ScrobbleItem } from "./types";

declare global {
  interface Window {
    myshows_poc_ready?: boolean;
  }
}

(function () {
  "use strict";

  if (window.myshows_poc_ready) return;
  window.myshows_poc_ready = true;

  function log(...args: unknown[]): void {
    try {
      console.log.apply(console, ["[MyShows PoC]", ...args]);
    } catch {
      /* noop */
    }
  }

  function init(): void {
    const demo: ScrobbleItem = {
      card: { tmdb: 42, title: "Demo Show" },
      season: 1,
      episode: 2,
      percent: 87.43,
    };
    log(PLUGIN_ID, VERSION, "payload", JSON.stringify(buildPayload(demo)));
  }

  if (window.Lampa) init();
  else if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
