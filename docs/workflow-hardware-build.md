# Babel Listener — Hardware Build Workflow

**Date:** 2026-05-13  
**Source docs:** `hardware-listener-requirements.md` · `hardware-listener-design.md` · `hardware-design-deck.md` · `hardware-procurement.md`  
**Next step:** `/sc:implement` per phase

---

## Dependency Map

```
Phase 0: Procurement
    │
    ├──→ Phase 1: Firmware POC (needs boards + breadboard components)
    │         │
    │         └──→ Phase 3: Firmware Complete (needs PCB rev A)
    │
    ├──→ Phase 2: Peripheral PCB Rev A (needs confirmed GPIO pinouts)
    │         │
    │         ├──→ Phase 3: Firmware Complete
    │         └──→ Phase 4: Housing Prototype (needs PCB dimensions locked)
    │
    └──→ Phase 4: Housing Prototype (needs battery dimensions confirmed)
              │
              ├──→ Phase 5: Provisioning App
              └──→ Phase 6: Pilot Integration (needs all of the above)
                        │
                        └──→ Phase 7: Pilot Event
```

---

## Phase 0 — Procurement & Pinout Extraction
**Goal:** All components ordered, GPIO maps documented, PCB design can begin  
**Parallel with:** Nothing — this unblocks everything else  
**Duration:** ~3–5 days (shipping dependent)

### Tasks

#### 0.1 Order boards
- [ ] Order 6× Waveshare ESP32-S3-Touch-LCD-2.8B
- [ ] Order 6× Waveshare ESP32-S3-Touch-LCD-5
- [ ] Sources: [waveshare.com/esp32-s3-touch-lcd-2.8b.htm](https://www.waveshare.com/esp32-s3-touch-lcd-2.8b.htm) · [waveshare.com/esp32-s3-touch-lcd-5.htm](https://www.waveshare.com/esp32-s3-touch-lcd-5.htm)

#### 0.2 Order batteries
- [ ] Order 6× AKZYTUE 6000mAh LiPo (Pro) — verify PH2.0 polarity on delivery before connecting
- [ ] Order 6× AKZYTUE 4000mAh LiPo (Lite) — verify JST polarity on delivery before connecting
- [ ] Do NOT connect either battery until polarity is physically confirmed against board header

#### 0.3 Order through-hole components
- [ ] 15× Philmore 70-539 TRRS 3.5mm panel mount jack
- [ ] 1× Hilitchi 6×6mm tactile button kit (200-pack)
- [ ] 1× Passive piezo buzzer pack (20-pack)
- [ ] Pogo pin receptacles: source "Mil-Max 0906" or equivalent spring-loaded pogo pin receptacles, 2-pin pairs × 15

#### 0.4 Source chips for PCB (DigiKey or LCSC)
- [ ] 15× PCM5102A — DigiKey part `PCM5102APWR` (TSSOP-20)
- [ ] 15× TPA6130A2 — DigiKey part `TPA6130A2RTJR` (DQFN-16)
- [ ] 8× LIS3DH — DigiKey part `LIS3DHTR` (LGA-16, Pro only + spares)
- [ ] Standard passives: 100nF caps, 4.7µF caps, 10kΩ resistors, 100kΩ resistors (0402)
- [ ] 15× ZIF FFC/FPC connector (0.5mm pitch, pin count TBD in task 0.5)
- [ ] 15× dual-color SMD LED 0402 (red/green)

#### 0.5 Extract GPIO pinouts
- [ ] Download Waveshare 2.8B schematic — identify: I2S pins, I2C pins, 4 free GPIOs, power button pad, USB-C data lines
- [ ] Download Waveshare 5" schematic — same extraction
- [ ] Document in `hardware-gpio-map.md`: pin number → signal → peripheral PCB net
- [ ] Confirm FFC connector pin count from available GPIO count
- [ ] Confirm power button pad location relative to board edge (for housing cutout alignment)

#### 0.6 Confirm battery fit
- [ ] Measure delivered Lite 4000mAh battery (expected 100×50×6mm) — confirm fits behind 2.8B board in housing footprint
- [ ] Measure delivered Pro 6000mAh battery (expected 90×60×9mm) — confirm fits behind 5" board
- [ ] If dimensions don't fit: identify alternative capacity/dimensions before PCB layout locks housing size

#### Checkpoint 0 ✓
All boards in hand, GPIO map documented, battery dimensions confirmed, chip order placed → **Phase 1 and Phase 2 can start in parallel**

---

## Phase 1 — Firmware POC (Audio Pipeline)
**Goal:** Prove WiFi → WebSocket → PCM16 audio → I2S → 3.5mm earbuds works end to end  
**Requires:** 1× Waveshare Pro or Lite board, breadboard, PCM5102A GY module (order separately for POC), earbuds  
**Duration:** ~1–2 weeks  
**Parallel with:** Phase 2

### Tasks

#### 1.1 Dev environment setup
- [ ] Install Arduino IDE + ESP32-S3 Arduino core
- [ ] Install libraries: `arduinoWebSockets`, `ArduinoJson`, `ESP32 I2S`, `LVGL`
- [ ] Flash a hello-world sketch to confirm board is working

#### 1.2 WiFi + WebSocket connection
- [ ] Hardcode WiFi credentials + Babel worker URL
- [ ] Connect to `{workerUrl}/ws`
- [ ] Send `join` JSON message with hardcoded `eventCode` + `lang`
- [ ] Confirm `joined` response received and parsed

#### 1.3 Audio pipeline
- [ ] Wire PCM5102A GY module to ESP32-S3 I2S pins (BCLK, LRCLK, DIN)
- [ ] On binary WebSocket frame: push to FreeRTOS ring buffer (PSRAM)
- [ ] I2S DMA task reads ring buffer → feeds PCM5102A
- [ ] Plug in earbuds → confirm audible translated speech
- [ ] Measure: latency from stream to audible output (target < 500ms buffering)

#### 1.4 Language switching
- [ ] Implement `switchLang()` — sends `switch_lang` JSON, firmware updates state
- [ ] Confirm audio stream switches without disconnect

#### 1.5 Reconnect logic
- [ ] Simulate WiFi drop — confirm firmware reconnects (5× / 2s backoff, matching `viewer-client.ts`)
- [ ] Simulate worker disconnect — same behavior

#### 1.6 Bluetooth A2DP (neckloop)
- [ ] Enable Classic BT + A2DP source in Arduino sketch
- [ ] Duplicate PCM16 mono audio to A2DP pipeline in parallel with I2S
- [ ] Pair a BT neckloop/earphone — confirm audio on both I2S and BT simultaneously

#### Checkpoint 1 ✓
Audio plays through both 3.5mm and BT. Reconnect works. Language switch works → **Phase 3 can begin in parallel with Phase 2 completion**

---

## Phase 2 — Peripheral PCB Rev A
**Goal:** Manufacturable PCB design, JLCPCB order placed  
**Requires:** GPIO map from Phase 0.5, confirmed housing footprint  
**Duration:** ~1–2 weeks design + ~2 weeks fab  
**Parallel with:** Phase 1

### Tasks

#### 2.1 Schematic
- [ ] Draw schematic in KiCad (or EasyEDA for LCSC/JLCPCB workflow):
  - PCM5102A: I2S input, 3.3V supply, XSMT pin to ESP32 GPIO (soft mute)
  - TPA6130A2: I2C input (SDA/SCL + 10kΩ pull-ups), line-in from PCM5102A, output to TRRS jack
  - LIS3DH: I2C shared bus, INT1 to ESP32 GPIO, supply decoupling
  - TRRS jack: TPA6130A2 L/R outputs + GND + Mic pin (NC or to future input)
  - 2× tactile buttons: GPIO + GND, 10kΩ pull-up to 3.3V
  - Passive piezo: GPIO → NPN transistor → piezo → GND (3.3V logic drive)
  - Dual-color LED: 2× GPIOs → current limiting resistors → LED anode/cathode
  - Pogo pins: +5V and GND pads, route to board's USB-C VBUS/GND or charging input
  - USB-C port: VBUS, GND, D+, D− connected to main board USB-C breakout pads
  - FFC/FPC ZIF connector: all signal nets from GPIO map

#### 2.2 PCB layout
- [ ] Size PCB to fit within confirmed housing footprint
- [ ] Place connectors at their designated positions:
  - **Top edge:** TRRS jack + LED light pipe pad
  - **Bottom edge:** Pogo pin receptacles + USB-C port (side by side)
  - **Side edge:** 2× tactile buttons (centered, 15mm apart)
  - **Power button:** cutout alignment marker (no component — housing aligns to main board button)
- [ ] Route audio signal traces away from digital/switching traces (guard ground plane)
- [ ] ENIG surface finish on pogo pin pads
- [ ] 4× M2 mounting holes at corners

#### 2.3 Design review
- [ ] Check: all FFC pins connected, no floating inputs
- [ ] Check: LIS3DH I2C address conflict with any Waveshare onboard peripherals
- [ ] Check: TPA6130A2 I2C address (0x60) — confirm no clash
- [ ] Check: decoupling caps on every IC supply pin
- [ ] Check: pogo pin pad current rating ≥ 1A

#### 2.4 JLCPCB order
- [ ] Export Gerbers + BOM + CPL (component placement list)
- [ ] Upload to JLCPCB — select SMD assembly for PCM5102A, TPA6130A2, LIS3DH, buzzer, passives, LED
- [ ] Hand-solder list: TRRS jack, 2× buttons, pogo pins, USB-C, ZIF connector
- [ ] Order 12 boards (10 build + 2 spare)

#### Checkpoint 2 ✓
PCBs ordered → begin Phase 4 housing design in parallel with PCB shipping

---

## Phase 3 — Firmware Complete
**Goal:** Full production firmware on both tiers  
**Requires:** Peripheral PCBs from Phase 2, boards from Phase 0  
**Duration:** ~2–3 weeks  
**Parallel with:** Phase 4

### Tasks

#### 3.1 NVS provisioning layer
- [ ] Define NVS namespace `"babel"` with all keys from design doc Section 11
- [ ] Implement `burn_unit_id()` — called once at manufacture flash
- [ ] Implement `read_config()` / `write_config()` — used by provisioning receiver
- [ ] Boot logic: if `wifi_ssid` empty → enter BLE provisioning mode; else → connect and stream

#### 3.2 BLE provisioning receiver
- [ ] Scan for BLE extended advertisements with service UUID `0xBABE`
- [ ] Decode JSON payload: `{ssid, pwd, url, code, lang, alarm_ms, v}`
- [ ] Reject if `v < prov_ver` (stale provisioning attempt)
- [ ] Write to NVS on valid receive → reboot into stream mode
- [ ] Display: "✓ Provisioned" on touchscreen

#### 3.3 BLE beacon (anti-theft)
- [ ] Advertise continuously with service UUID `0xBABE`
- [ ] Manufacturer data payload: `[unit_id: uint16][battery_pct: uint8][stream_state: uint8]`
- [ ] Runs in parallel with stream mode — BLE and WiFi coexist on ESP32-S3

#### 3.4 Anti-theft WiFi-loss alarm
- [ ] Watchdog: if WiFi disconnected > `alarm_ms` (default 300s) → fire piezo alarm pattern
- [ ] Pattern: 3 beeps every 30s
- [ ] Cancel on WiFi reconnect

#### 3.5 Peripheral PCB drivers
- [ ] I2C scan on boot — confirm TPA6130A2 (0x60) and LIS3DH (0x18/0x19) respond
- [ ] TPA6130A2: init volume to 50%, implement `set_volume(pct)` via I2C
- [ ] LIS3DH (Pro): init orientation detection, configure INT1 interrupt threshold
- [ ] Interrupt handler: on LIS3DH INT1 → debounce 500ms → call `rotate_display()`
- [ ] Charge LED: GPIO logic — red on charge input present + not full, green on full, off otherwise

#### 3.6 LVGL UI — shared
- [ ] Implement screen states: Provisioning · Stream Active · Lang Picker · Error · Event Ended
- [ ] Stream Active screen: language name (large) · battery % · volume bar · stream status dot
- [ ] Lang Picker: scrollable list, populated from `joined` response language list
- [ ] Error screen: error code + reconnect attempt counter
- [ ] Button A/B handlers: short press = scroll lang picker; long press (>800ms) = adjust volume

#### 3.7 LVGL UI — Lite (2.8" 480×640 portrait)
- [ ] Portrait-only layout: language prominent, volume bar at bottom, no caption area
- [ ] `DEVICE_TIER = LITE` compile flag gates caption code out

#### 3.8 LVGL UI — Pro (5" 1024×600 landscape + portrait)
- [ ] Landscape layout: status bar top, language center-left, caption scroll area center-right
- [ ] Portrait layout (auto-rotated): language top, caption scroll fills center, volume bottom
- [ ] `DEVICE_TIER = PRO` compile flag enables caption rendering and IMU rotation logic
- [ ] Caption renderer: append `caption.text` lines, scroll on `final: true`, clear on speaker change

#### 3.9 Boot time validation
- [ ] Measure time from power-on to `joined` WebSocket message received
- [ ] Target: < 2 seconds on known WiFi network
- [ ] Profile: WiFi connect · WS open · join send · joined receive
- [ ] Optimise if over target: reduce WiFi scan dwell time, pre-cache BSSID in NVS

#### 3.10 Manufacture flash script
- [ ] Script: flash firmware + burn unique `unit_id` to NVS for each device
- [ ] Unit IDs: `BABEL-0001` through `BABEL-0400` (or batch range)
- [ ] Verify: serial output confirms unit_id written correctly before moving to next device

#### Checkpoint 3 ✓
Both tier firmwares pass 2s boot test, all peripheral PCB functions verified → **Phase 6 integration can begin**

---

## Phase 4 — Housing Prototype
**Goal:** 3D-printed housings for both tiers, fit-check all components  
**Requires:** PCB dimensions locked (Phase 2.2), battery dimensions confirmed (Phase 0.6)  
**Duration:** ~1–2 weeks design + ~1 week print iteration  
**Parallel with:** Phase 3

### Tasks

#### 4.1 3D model — Lite
- [ ] Model clamshell in CAD (Fusion 360 / SolidWorks / Onshape)
- [ ] Front shell: display window opening (2.8" + bezel), tempered glass recess (2mm depth, OCA margin)
- [ ] Front shell: top edge cutout for TRRS jack, top-right hole Ø1.5mm for LED light pipe, top-left Ø3mm lanyard eyelet
- [ ] Front shell: right side slots for Button A and Button B (7×7mm, 15mm apart)
- [ ] Front shell: alignment for main board power button cutout (from Waveshare 2.8B datasheet)
- [ ] Back shell: bottom edge cutouts for pogo pins (2× Ø2.5mm recessed 0.5mm) + USB-C slot (9×3.5mm)
- [ ] Back shell: full-width belt clip rail groove (8×3mm channel, 10mm from bottom)
- [ ] Internal: battery pocket, PCB standoffs (M2), FFC cable routing channel
- [ ] 4× M2 screw bosses at corners, Torx T6 insert

#### 4.2 3D model — Pro
- [ ] Same structure as Lite, scaled to 5" board footprint (112×75mm)
- [ ] Landscape orientation: button slots on **bottom edge** (2 buttons, 20mm apart, centered)
- [ ] Power button: bottom edge or short-side (confirm from Waveshare 5" board layout)
- [ ] Internal: larger battery pocket (90×60×9mm), FFC routing

#### 4.3 Print Rev A
- [ ] Print both housings in PLA/PETG (functional prototype material)
- [ ] Dry-fit: insert main board + peripheral PCB + battery — check clearances
- [ ] Check: TRRS jack protrudes correctly through top cutout
- [ ] Check: buttons actuate PCB tactile switches cleanly through slots
- [ ] Check: pogo pins align with bottom edge recess
- [ ] Check: USB-C port accessible without tools
- [ ] Check: power button cutout aligns to main board button — if not, switch to Option B (replicate on PCB)
- [ ] Check: FFC cable has enough slack / correct routing channel

#### 4.4 Rev B (if needed)
- [ ] Correct any fit issues from 4.3 — reprint revised shells
- [ ] Fit-check LED light pipe routing (3mm acrylic rod from PCB LED to top hole)

#### 4.5 Belt clip
- [ ] Design minimal slim clip in CAD: slides into back groove, spring tension holds device on belt/bag
- [ ] Print in PETG (needs flex) — test retention force

#### Checkpoint 4 ✓
Both housings fit all components cleanly, button travel correct, ports accessible → **Phase 6 integration can begin**

---

## Phase 5 — Provisioning & Fleet App (React Native + Expo)
**Goal:** Staff tablet app — broadcast config + BLE sweep  
**Duration:** ~2–3 weeks  
**Parallel with:** Phases 3 and 4

### Tasks

#### 5.1 Project setup
- [ ] `npx create-expo-app babel-staff --template blank-typescript`
- [ ] Install: `react-native-ble-plx` (BLE), `expo-location` (required for BLE scan on Android)
- [ ] Configure permissions: iOS `NSBluetoothAlwaysUsageDescription`, Android `BLUETOOTH_SCAN` + `BLUETOOTH_ADVERTISE`

#### 5.2 Provision mode
- [ ] Screen: input fields for WiFi SSID, WiFi password, Babel event code, default language
- [ ] On "Broadcast": encode payload as JSON (≤200 bytes), advertise as BLE extended advertisement with service UUID `0xBABE`
- [ ] Broadcast for 60 seconds (configurable) — all nearby devices in provisioning mode will receive and auto-configure
- [ ] Status: show count of provisioned devices as they confirm (devices re-advertise with `stream_state: PROVISIONED`)

#### 5.3 Fleet sweep mode
- [ ] Scan for BLE advertisements with service UUID `0xBABE`
- [ ] Parse manufacturer data: `unit_id`, `battery_pct`, `stream_state`
- [ ] Display list: Unit ID · Battery % · Status · RSSI signal strength
- [ ] Counter: detected / expected (expected count entered manually or from event config)
- [ ] Highlight in red: any unit not seen in last 30 seconds
- [ ] Filter: "Show missing only" toggle

#### 5.4 Event config persistence
- [ ] Store recent event configs locally (AsyncStorage) — staff can re-select without retyping
- [ ] Export sweep report as CSV (unit IDs + last-seen timestamps) for post-event reconciliation

#### Checkpoint 5 ✓
Staff app provisions 10 devices in a single broadcast, sweep detects all 10 → **Phase 6 integration test ready**

---

## Phase 6 — Pilot Integration (10-unit build)
**Goal:** 10 complete working devices (5 Lite + 5 Pro), full stack test  
**Requires:** All of Phases 1–5 complete  
**Duration:** ~1 week

### Tasks

#### 6.1 Assembly
- [ ] Solder through-hole components on all 12 peripheral PCBs (TRRS, buttons, pogo pins, USB-C, ZIF)
- [ ] Connect peripheral PCB to main board via FFC
- [ ] Connect battery (polarity confirmed)
- [ ] Power on bare — confirm boot, display init, BLE advertising
- [ ] Flash manufacture script: assign unit IDs BABEL-0001 through BABEL-0010

#### 6.2 Fit into housings
- [ ] Insert assemblies into printed housings (Rev B from Phase 4)
- [ ] Fit tempered glass lenses (use temporary adhesive for prototype — full OCA bond at production)
- [ ] Attach belt clips
- [ ] Insert lanyard eyelets

#### 6.3 Full stack test per device
For each of the 10 devices:
- [ ] Provision via staff tablet app → confirm auto-connects and streams
- [ ] Audio check: 3.5mm earbuds → clear translated speech
- [ ] Audio check: BT neckloop → same audio
- [ ] Language switch: select 3 languages → audio follows
- [ ] Volume: button A long-press up · button B long-press down
- [ ] BLE sweep: all 10 units visible in fleet sweep
- [ ] Alarm test: disable WiFi → confirm piezo alarm fires at 5 minutes
- [ ] Charge LED: place in charging slot → red LED visible through top
- [ ] Battery runtime: run continuous stream for 12 hours → confirm battery survives

#### 6.4 Boot time measurement
- [ ] Measure cold boot → stream ready on all 10 devices
- [ ] All must be ≤ 2 seconds — fix any that aren't before moving to Phase 7

#### 6.5 Provisioning scale test
- [ ] Power on all 10 devices in provisioning mode
- [ ] Single broadcast from staff tablet → all 10 provision within 30 seconds
- [ ] Re-provision with different event code → all 10 update

#### Checkpoint 6 ✓
All 10 devices pass full stack test, boot time ≤ 2s, provisioning works at 10-unit scale → **Phase 7 pilot event**

---

## Phase 7 — Pilot Event
**Goal:** Real-world deployment at a small live event (20–50 units)  
**Requires:** Phase 6 complete + production run of housing + additional unit assembly  
**Duration:** 1 event

### Tasks

#### 7.1 Pre-event
- [ ] Assemble 20–50 devices from pilot build parts
- [ ] Charge full fleet in charging cases overnight
- [ ] Staff briefing: provisioning workflow, sweep app, collection procedure

#### 7.2 During event
- [ ] Provision full fleet via staff app (< 15 minutes target)
- [ ] Monitor: sweep app open throughout event, watch for missing units
- [ ] Monitor: Babel worker dashboard — listener counts per language
- [ ] Collect attendee feedback: audio quality, UI clarity, earbud comfort

#### 7.3 Post-event
- [ ] Count returned devices via sweep app
- [ ] Export CSV sweep report — identify any unreturned units
- [ ] Log: battery remaining per device after full event
- [ ] Document issues for iteration before scaling to 400

#### Checkpoint 7 ✓
Event runs without technical incidents, all devices recovered, battery lasted full event → **ready to scale to 400-unit fleet**

---

## Summary Timeline (Optimistic)

| Phase | Start | Duration | Dependency |
|---|---|---|---|
| 0 — Procurement | Week 1 | 1 week order + shipping | — |
| 1 — Firmware POC | Week 2 | 2 weeks | Boards in hand |
| 2 — Peripheral PCB | Week 2 | 2 weeks design + 2 weeks fab | GPIO map done |
| 3 — Firmware Complete | Week 4 | 3 weeks | PCBs in hand + POC done |
| 4 — Housing Prototype | Week 4 | 2 weeks | PCB dimensions locked |
| 5 — Provisioning App | Week 2 | 3 weeks | Parallel |
| 6 — Pilot Integration | Week 7 | 1 week | All above |
| 7 — Pilot Event | Week 8+ | 1 event | 20–50 units assembled |

**Earliest pilot event: Week 9–10** from project start.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Waveshare 5" board USB-C charges at 580mA only — R45 mod requires SMD rework | Medium | Medium | Test charging mod on 1 board before ordering R45 resistors in bulk |
| Boot time > 2s on known WiFi | Medium | High | Profile early in Phase 1; reduce scan dwell time in firmware |
| LIS3DH I2C address conflicts with Waveshare onboard peripheral | Low | Medium | Check both board schematics in Phase 0.5 before PCB schematic |
| Power button cutout misaligns to main board button | Medium | Low | Fallback: add 3rd button to PCB Rev B (1-week delay) |
| FFC cable length insufficient for board stack | Low | Medium | Measure physical stack height in Phase 4.3 dry-fit |
| JLCPCB assembly error on DQFN-16 TPA6130A2 | Medium | Medium | Order 2 extra boards; AOI inspection option on JLCPCB |
| Battery polarity mismatch destroys board | Low | High | Physical confirmation step in Phase 0.6 — never skip |
