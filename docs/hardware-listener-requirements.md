# Babel Listener — Hardware Tier Requirements Specification

**Date:** 2026-05-12  
**Status:** Draft — ready for `/sc:design`

---

## Problem Statement

Eliminate the "bring your own phone" friction from Babel events. A Babel-owned, staff-deployed dedicated translation receiver that attendees pick up, power on, and use within seconds — no app, no personal device, no configuration.

---

## System Overview

Babel staff provisions a fleet of up to 400 devices before each event (WiFi credentials + event stream URL). Attendees pick up a device, power on, select language, plug in earbuds or pair a neckloop. Devices are returned at the end and placed in charging cases for the next event.

---

## Functional Requirements

### Device — Core Behavior

| # | Requirement |
|---|---|
| F1 | On power-on, device auto-connects to pre-provisioned WiFi and loads the Babel audio stream |
| F2 | Stream-ready state achieved within **2 seconds** of power-on (when pre-provisioned) |
| F3 | Device speaks the Babel streaming protocol directly via custom firmware (no browser/Linux — ESP32-class MCU) |
| F4 | OLED display (~3–4" range) shows: current language, stream status, battery level, volume level |
| F5 | User controls: language selection (up/down), volume (up/down), power on/off |
| F6 | Audio output: 3.5mm jack, USB-C audio, Bluetooth (neckloop / T-coil hearing loop compatible) |
| F7 | **10–12 hour continuous runtime** on a single charge (hard requirement) |
| F8 | Live captions on display — **nice to have**, display must be sized to support it when implemented |

### Fleet Provisioning (Pre-Event, Staff-Operated)

| # | Requirement |
|---|---|
| P1 | Babel staff provisions all devices via a single wireless broadcast push |
| P2 | Push payload: WiFi SSID + password + Babel event stream URL |
| P3 | Protocol: BLE broadcast or ESP-NOW (no per-device pairing step) |
| P4 | Full 400-unit fleet provisionable in **under 15 minutes** |
| P5 | Devices go idle after provisioning — staff power on at event start |

### Anti-Theft / Asset Management (Three-Layer)

| Layer | Method |
|---|---|
| Physical | Numbered labels on each device; manual count at door in/out |
| Digital sweep | Each device acts as BLE beacon; staff tablet app sweeps room and flags missing units |
| Passive alarm | Device emits audible alert if WiFi connection drops for configurable duration (detects removal from venue) |

### Charging & Storage

| # | Requirement |
|---|---|
| C1 | Custom charging cases with per-slot USB-C charging tails (hotel remote rack style) |
| C2 | Cases sized for transport between events — Babel owns and ships the fleet |
| C3 | Target: full 400-unit fleet charges overnight (standard power, no exotic infrastructure) |

---

## Non-Functional Requirements

| Dimension | Target |
|---|---|
| BOM cost | Sub-$50/unit |
| Fleet size | Up to 400 units/event |
| Form factor | Phone/tablet slab — larger is acceptable (attendees are seated), prioritize display size + battery |
| Display | OLED, sized for readable captions (~3–4") |
| MCU platform | ESP32-class (WiFi + BLE built-in, power efficient, large ecosystem) |
| Development approach | Ready-made dev board(s) in custom housing — fastest path to prototype |
| Hearing accessibility | Bluetooth neckloop compatible (no embedded induction loop required) |
| Regulatory | Not required for initial deployment |
| Timeline | ASAP — prototype before pilot event |

---

## User Stories

### Attendee
- I pick up a device from a rack, power it on, and within 2 seconds I can select my language and hear translated audio through my earbuds
- I can use my own 3.5mm earbuds, plug into USB-C, or pair my Bluetooth hearing neckloop — no app needed
- The screen is large enough for me to read captions if enabled

### Babel Event Staff
- I provision 400 devices in one broadcast push before the event — I don't touch each device individually
- I can sweep the room with a staff tablet to detect any unreturned units at the end of the event
- I drop all devices into the charging cases after the event; they're ready for the next one

---

## Provisioning App (Staff Tablet) — Scope

> **Document only — build deferred**

The staff tablet app (iOS/Android) needs to:

1. **Provision mode:** Broadcast WiFi credentials + event URL to all nearby devices simultaneously via BLE/ESP-NOW
2. **Sweep mode:** Scan for BLE beacons from all fleet devices; highlight missing unit IDs on a list/map view
3. **Fleet inventory:** Show total expected vs. detected device count in real time

---

## Open Architecture Decision (for `/sc:design`)

**Firmware vs. protocol:** The device must speak the Babel streaming protocol natively in firmware (no browser). This requires defining or adapting a lightweight client that mirrors what `lib/viewer-client.ts` does on the web — specifically:
- WebSocket or WebRTC audio stream consumption
- Language selection signaling
- Reconnection / error handling

This is the primary design task before any hardware selection is finalized.

---

## Out of Scope (v1)

- FCC / CE certification
- GPS or active location tracking
- On-device recording or local storage
- Embedded induction hearing loop transmitter
- Consumer retail packaging or branding

---

## Next Steps

1. `/sc:design` — Select dev board, finalize MCU + display + battery stack, define firmware architecture and Babel protocol client
2. `/sc:workflow` — Phase plan: firmware → housing → charging case → provisioning app
