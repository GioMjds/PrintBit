import type { Request, Response, NextFunction } from "express";
import type { SessionStore } from "../services/session";
import { CAPTIVE_PORTAL_ENABLED } from "../config/http";

/**
 * Known captive-portal detection paths used by mobile OSes:
 *  iOS     – /hotspot-detect.html
 *  Android – /generate_204, /gen_204
 *  Windows – /connecttest.txt, /ncsi.txt
 *  Firefox – /success.txt
 */
const CAPTIVE_PATHS = new Set([
  "/hotspot-detect.html",
  "/generate_204",
  "/gen_204",
  "/connecttest.txt",
  "/ncsi.txt",
  "/success.txt",
  "/redirect",
  "/canonical.html",
]);

/** Hostnames used by OS-level captive-portal probes. */
const CAPTIVE_HOSTS = new Set([
  "captive.apple.com",
  "www.apple.com",
  "connectivitycheck.gstatic.com",
  "clients3.google.com",
  "www.msftconnecttest.com",
  "www.msftncsi.com",
  "detectportal.firefox.com",
  "nmcheck.gnome.org",
  "network-test.debian.org",
]);

export function createCaptivePortalMiddleware(sessionStore: SessionStore) {
  return function captivePortal(req: Request, res: Response, next: NextFunction): void {
    if (!CAPTIVE_PORTAL_ENABLED) { next(); return; }

    const host = (req.hostname ?? "").toLowerCase();
    const path = req.path.toLowerCase();

    const isCaptiveProbe = CAPTIVE_HOSTS.has(host) || CAPTIVE_PATHS.has(path);
    if (!isCaptiveProbe) { next(); return; }

    // Redirect to the most recent session's upload page
    const token = sessionStore.getActiveSessionToken();
    if (token) {
      res.redirect(302, `/upload/${encodeURIComponent(token)}`);
    } else {
      // No active session — return a simple "not-internet" response
      // so the phone keeps showing the captive portal popup
      res.status(200).type("html").send(
        `<html><body><h2>PrintBit Kiosk</h2><p>Please start a Print session on the kiosk screen first.</p></body></html>`,
      );
    }
  };
}
