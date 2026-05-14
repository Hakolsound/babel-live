# Babel Listener — Hardware Design Specification

**Date:** 2026-05-12  
**Status:** Draft — approved for prototype build  
**Feeds from:** `hardware-listener-requirements.md`  
**Next step:** `/sc:workflow` for phase plan

---

## Product Tiers

| | **Listener Lite** | **Listener Pro** |
|---|---|---|
| Display | 2.8" IPS 480×640 portrait | **5" IPS 1024×600** landscape |
| Board | ESP32-S3-Touch-LCD-2.8B | **ESP32-S3-Touch-LCD-5** |
| Captions | No | Yes |
| Audio output | PCM5102A DAC + **TPA6130A2 amp** | PCM5102A DAC + **TPA6130A2 amp** |
| Battery | **4000mAh quality LiPo** (~16h) | **6000mAh quality LiPo** (~16h) |
| Charge time | ~2h @ 2A | ~6h @ 1A (R45 mod) |
| Size | ~6.5 × 8.5 × 1.5cm | ~11.2 × 7.5 × 1.9cm |
| Auto-orientation | No | Yes (LIS3DH on peripheral PCB) |
| BOM | ~$41 | ~$62 |
| Firmware | Shared codebase — display config + caption + IMU feature flags differ only | ← same |

---

## 1. Protocol Analysis

Before hardware selection, the Babel streaming protocol must be understood. It is simple and firmware-friendly.

### Transport
- Single WebSocket connection to `{workerUrl}/ws`
- Binary messages: raw audio frames (PCM16, 48 kHz, mono — confirmed from `sampleRate: 48000` in `viewer.ts:33`)
- Text messages: JSON

### Message Contract

**Device → Worker (Upstream)**
```json
{ "type": "join",        "eventCode": "ABC123", "lang": "es" }
{ "type": "switch_lang", "lang": "fr" }
{ "type": "leave" }
```

**Worker → Device (Downstream)**
```json
{ "type": "joined",         "lang": "es", "sampleRate": 48000 }
{ "type": "caption",        "text": "...", "ts": 1234, "final": true }
{ "type": "speaking_started" }
{ "type": "speaking_ended" }
{ "type": "event_ended" }
{ "type": "error",          "code": "EVENT_NOT_FOUND", "message": "..." }
```
Binary frames: raw PCM16 LE, 48 kHz, mono, variable length chunks (from ElevenLabs TTS pipeline).

### Firmware Implications
- No TLS termination complexity beyond standard WSS (ESP32-S3 has mbedTLS built in)
- No custom binary protocol to parse — binary = audio, text = JSON
- Reconnect: mirror `viewer-client.ts` behavior: 5 attempts, 2s backoff
- No audio decoding: PCM16 is already raw samples — direct I2S feed

---

## 2. Hardware Stack

### 2.1 Boards

#### Listener Pro — Waveshare ESP32-S3-Touch-LCD-5

| Spec | Value |
|---|---|
| MCU | ESP32-S3 dual-core Xtensa LX7 @ 240MHz |
| RAM | 512KB SRAM + 8MB PSRAM |
| Flash | 16MB |
| Display | **5" IPS LCD 1024×600**, 65K color, 160° viewing angle, capacitive touch |
| Connectivity | WiFi 802.11 b/g/n + BLE 5.0 |
| Battery | MX1.25 connector, charges via USB-C (CS8501, R45 mod → 1A) |
| PCB size | 112.4 × 75.1mm |
| Estimated cost | ~$30–35 |

#### Listener Lite — Waveshare ESP32-S3-Touch-LCD-2.8B

| Spec | Value |
|---|---|
| MCU | ESP32-S3 dual-core Xtensa LX7 @ 240MHz |
| RAM | 512KB SRAM + 8MB PSRAM |
| Flash | 16MB |
| Display | 2.8" IPS RGB 480×640 portrait, capacitive touch |
| Connectivity | WiFi 802.11 b/g/n + BLE 5.0 |
| Battery | MX1.25 connector, charges via USB-C (MP1605GTF-Z, **2A native**) |
| Estimated cost | ~$16–20 |

Both boards share the same MCU, PSRAM, and connectivity — firmware is a single codebase with a compile-time `DEVICE_TIER` flag controlling display resolution, orientation, and caption feature enablement.

**Display note:** Requirements specified OLED. At 2.8–4.3" size, quality OLEDs cost $20–35 for the panel alone and are fragile under daily handling. IPS LCD delivers equivalent brightness, better sunlight readability, and longer service life at a fraction of the cost. Revisit OLED at v2 if feel is a priority.

### 2.2 Audio Output: PCM5102A DAC + TPA6130A2 Headphone Amp (both tiers)

Two-stage audio chain — the most impactful real-world audio upgrade possible in a battery device.

**Stage 1 — DAC: PCM5102A**

| Spec | Value |
|---|---|
| Interface | I2S (3-wire: BCLK, LRCLK, DATA) |
| SNR | 112dB |
| Output | Line-level stereo (~2Vrms) |
| Supply | 3.3V |
| Estimated cost | ~$5 |

112dB SNR already exceeds human hearing resolution. The bottleneck in earphone audio is the output stage, not the DAC chip — which is why the amp matters more than a DAC upgrade.

**Stage 2 — Headphone Amp: TPA6130A2**

| Spec | Value |
|---|---|
| Type | Class-G stereo headphone amplifier |
| Input | Line-level from PCM5102A |
| Output | 3.5mm jack, drives 16–600Ω earphones cleanly |
| SNR | 100dB |
| Supply | 3.3V |
| Volume | I2C digital control (64 steps) |
| Estimated cost | ~$5–8 |

Drives audiophile IEMs, standard earbuds, and Bluetooth neckloop receivers alike without clipping. The PCM5102A alone outputs line-level signal unsuited for direct headphone driving — this stage closes that gap.

**Bluetooth audio:** ESP32-S3 Classic BT A2DP source → neckloop receiver. SBC encode built into Arduino BT stack. No extra chip needed on either tier.

**USB-C audio:** Deferred — UAC on ESP32 requires significant driver work.

### 2.3 Battery & Power Budget

#### Listener Pro

| Component | Draw |
|---|---|
| ESP32-S3 (WiFi active) | ~160mA |
| 5" LCD @ 50% backlight | ~75mA |
| PCM5102A DAC + TPA6130A2 amp | ~20mA |
| BLE advertising | ~5mA |
| BMI270 IMU | ~1mA |
| **Total** | **~261mA** |

At 88% boost converter efficiency: ~374mA from battery.  
**Selected: 6000mAh quality LiPo → ~16h runtime. R45 mod for 1A charge → 6h charge time.**

#### Listener Lite

| Component | Draw |
|---|---|
| ESP32-S3 (WiFi active) | ~160mA |
| 2.8" LCD @ 50% backlight | ~35mA |
| PCM5102A DAC + TPA6130A2 amp | ~20mA |
| BLE advertising | ~5mA |
| **Total** | **~220mA** |

At 88% efficiency: ~315mA from battery.  
**Selected: 4000mAh quality LiPo → ~12.7h runtime. Native 2A charger → 2h charge time.**

### 2.4 Auto-Orientation IMU (Pro only)

| Spec | Value |
|---|---|
| Chip | **LIS3DH** (ST) 3-axis accelerometer |
| Package | LGA-16, 3×3×1mm — mounted on custom peripheral PCB |
| Interface | I2C (shares bus with peripheral PCB) |
| Supply | 1.71–3.6V, ~11µA low-power mode |
| Estimated cost | ~$1–2 (bare chip, DigiKey/Mouser) |

Mounted directly on the custom peripheral PCB (see Section 2.7). Firmware polls at 10Hz via I2C; orientation switches after 500ms stable hold. No separate module needed.

### 2.5 Controls: Tactile Buttons (both tiers)

- **2 buttons** on peripheral PCB: A (Up) + B (Down)
- Short press: Language ↑ / ↓
- Long press (>800ms): Volume ↑ / ↓
- Power: handled by main Waveshare board's own power circuit
- 6×6mm tactile SMD on peripheral PCB — ~$0.50

### 2.6 Peripheral PCB (both tiers)

A single custom PCB that hosts all peripheral components, connecting to the Waveshare board via a pin header or flat flex connector.

**Components on PCB:**

| Component | Package | Notes |
|---|---|---|
| PCM5102A DAC | TSSOP-20 | I2S from ESP32-S3 |
| TPA6130A2 headphone amp | DQFN-16 (RTJ) | I2C volume control, line-in from PCM5102A |
| LIS3DH IMU (Pro only) | LGA-16 3×3mm | I2C, INT1 pin to ESP32 GPIO |
| 3.5mm TRRS jack | Panel mount / SMD | Top edge of PCB |
| Tactile button × 2 | 6×6mm SMD | Exposed through housing cutouts |
| Passive piezo buzzer | SMD 12×9.5mm | GPIO PWM driven |
| Charging contacts +/- | Pogo pin pads | Bottom edge — mates with case charging rails |

**Charging contacts:**  
Two gold-plated spring pogo pin receptacles (e.g. Mil-Max 0906 series or equivalent) on the bottom edge. The charging case has matching rail contacts. Eliminates USB-C plugging for fleet charging — just drop the device into the case slot.

**PCB specs (prototype):**
- 2-layer, FR4
- Sized to match housing footprint
- JLCPCB assembly for SMD components (PCM5102A, TPA6130A2, LIS3DH, buzzer, passives)
- Through-hole: buttons, jack, pogo pins

### 2.7 Anti-Theft Buzzer (both tiers)

- Passive piezo 3V/3.5kHz, GPIO PWM — ~$0.50

### 2.7 BOM Summary

| Component | Lite | Pro |
|---|---|---|
| Waveshare board | $18 (2.8B) | $32 (5") |
| Custom peripheral PCB (JLCPCB assembled) | $8 | $8 |
| — PCM5102A + TPA6130A2 + passives (on PCB) | incl. | incl. |
| — LIS3DH IMU (on PCB, Pro only) | — | incl. |
| — 2× buttons, TRRS jack, piezo, pogo pins (on PCB) | incl. | incl. |
| Quality LiPo battery | $9 (4000mAh) | $14 (6000mAh) |
| 3D-printed housing (prototype) | $4 | $6 |
| Misc (headers, connectors, wire) | $2 | $2 |
| **Total** | **~$41** | **~$62** |

---

## 3. Firmware Architecture

Runtime: **Arduino framework (C++)** on ESP32-S3 Arduino core. Single firmware repo, `DEVICE_TIER` compile flag selects display driver, resolution, and caption feature. MicroPython ruled out — too heavy for real-time audio DMA.

### 3.1 Task Map

```
┌─────────────────────────────────────────────────────────┐
│                     FreeRTOS Tasks                       │
├──────────────┬──────────────┬──────────────┬────────────┤
│  net_task    │  audio_task  │   ui_task    │  ble_task  │
│  Core 0      │  Core 1      │  Core 0      │  Core 0    │
│  Priority 5  │  Priority 6  │  Priority 3  │  Priority 2│
├──────────────┼──────────────┼──────────────┼────────────┤
│ WiFi mgmt    │ I2S DMA feed │ LVGL render  │ BLE advert │
│ WebSocket    │ Audio queue  │ Button input │ Prov listen│
│ JSON parse   │ A2DP source  │ State display│ Sweep mode │
│ Reconnect    │ Volume ctrl  │ IMU poll     │            │
│              │              │ (Pro: 10Hz,  │            │
│              │              │ auto-rotate) │            │
└──────────────┴──────────────┴──────────────┴────────────┘
         ↕ shared via queues/semaphores ↕
┌──────────────────────────────────────────────────────────┐
│                  Shared State (NVS + RAM)                  │
│  wifi_ssid | wifi_pwd | event_url | event_code           │
│  selected_lang | volume | unit_id | stream_state         │
└──────────────────────────────────────────────────────────┘
```

### 3.2 Boot Sequence

```
Power on
  │
  ├─ Read NVS
  │    ├─ Provisioned? ──→ WiFi connect → WebSocket connect → send join → stream
  │    └─ Not provisioned? → enter BLE provisioning mode (advertise + scan)
  │
  ├─ WiFi connect (timeout 5s)
  │    ├─ Success → WebSocket open → send join{eventCode, lang}
  │    └─ Fail → display error, retry 3×, then enter provisioning mode
  │
  └─ Stream active
       ├─ Binary frame → audio queue → I2S/A2DP output
       ├─ "joined" → display lang + status green
       ├─ "caption" → render caption line on display
       ├─ "event_ended" → display ended screen
       └─ WS close → reconnect (5× / 2s backoff, then alarm)
```

Target: WiFi connect + WS open + join sent = **< 2 seconds** from power-on on warm provisioned boot.  
*(ESP32-S3 WiFi connect on known SSID: typically 800–1200ms; WS open + send: ~200ms → total ~1.4s)*

### 3.3 Audio Pipeline

```
WS binary frame received
    │ (Core 0, net_task)
    ▼
Ring buffer (PSRAM, 8MB available)
    │ 400ms headroom at 48kHz PCM16 mono = 38400 bytes — trivial
    │
    ├──→ I2S DMA → PCM5102A → 3.5mm jack
    │      (Core 1, audio_task, 48kHz, 16-bit, mono)
    │
    └──→ A2DP source pipeline → SBC encode → BT transmit → neckloop
           (same PCM16 source, ESP-IDF bt_app_a2d)
```

Volume: applied in software as a PCM gain multiplier before I2S write. 0–100% in 10% steps.

### 3.4 Firmware Protocol Client

Mirrors `lib/viewer-client.ts` exactly — same state machine in Arduino C++:

```cpp
// arduinoWebSockets library (WSS supported)
WebSocketsClient ws;

enum WsState { WS_IDLE, WS_CONNECTING, WS_OPEN, WS_RECONNECTING };

void onWsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      reconnectAttempts = 0;
      sendJoin(eventCode, selectedLang);  // mirrors viewer-client.ts onopen
      break;
    case WStype_BIN:
      audioQueue.push(payload, length);   // PCM16 mono @ 48kHz → I2S DMA
      break;
    case WStype_TEXT:
      handleJson((char*)payload);          // joined / caption / event_ended / error
      break;
    case WStype_DISCONNECTED:
      scheduleReconnect();                 // 5× max, 2000ms delay — mirrors TS client
      break;
  }
}

void switchLang(const char* lang) {
  ws.sendTXT("{\"type\":\"switch_lang\",\"lang\":\"" + String(lang) + "\"}");
  preferences.putString("def_lang", lang);  // persist to NVS
}
```

Library: **arduinoWebSockets** (WSS via mbedTLS, works on ESP32 Arduino core).

---

## 4. UI Design (LVGL v9)

Single LVGL codebase. Layout adapts to `DEVICE_TIER` at compile time.

### Listener Pro — 800×480 landscape (default)

```
┌──────────────────────────────────────────────────────┐
│  STREAM ACTIVE                    LANG PICKER         │
│  ┌────────────────────────────┐  ┌──────────────────┐│
│  │ ● LIVE          🔋 87%    │  │ Select Language  ││
│  │                            │  │ ──────────────── ││
│  │       ESPAÑOL              │  │ > Spanish        ││
│  │                            │  │   French         ││
│  │ "Welcome to today's        │  │   Hebrew         ││
│  │  conference..."            │  │   Arabic         ││
│  │  (caption scrolls here)    │  └──────────────────┘│
│  │  VOL ████░░░░  65%         │                       │
│  └────────────────────────────┘                       │
└──────────────────────────────────────────────────────┘
```

### Listener Pro — 480×800 portrait (auto-rotated)

```
┌─────────────────────┐
│  ● LIVE    🔋 87%  │
│                     │
│                     │
│      ESPAÑOL        │
│                     │
│                     │
│ ─────────────────── │
│ "Welcome to today's │
│  conference. The    │
│  speaker said..."   │
│  (captions scroll)  │
│ ─────────────────── │
│  VOL ████░░  65%   │
└─────────────────────┘
```

Portrait gives more captionlines — better for dense speech. Landscape is wider and suits resting the device on a knee. Auto-orientation lets the attendee choose naturally by how they hold it.

### Listener Lite — 480×640 portrait

```
┌─────────────────────┐
│  ● LIVE    🔋 87%  │
│                     │
│                     │
│      ESPAÑOL        │
│                     │
│  VOL ████░░  65%   │
│                     │
│  ───────────────    │  ← lang picker replaces
│  > Spanish          │    this area on select
│    French           │
│    Hebrew           │
└─────────────────────┘
```

Caption rendering is **compiled out** on Lite (`#if DEVICE_TIER == PRO`). No dead UI space on the smaller display.

### Button Mapping

| Button | Short press | Long press (>800ms) |
|---|---|---|
| UP | Language picker: scroll up | Volume up |
| DOWN | Language picker: scroll down | Volume down |
| SELECT/OK | Confirm language selection | Enter lang picker |
| POWER | Wake / sleep | Power off (3s) |

---

## 5. Provisioning System

### Protocol: BLE 5.0 Extended Advertising

Chosen over ESP-NOW because: works with standard iOS/Android without custom hardware; no WiFi channel dependency; BLE 5.0 extended advertising supports 255-byte payloads.

#### Payload Structure (CBOR or compact JSON, ≤200 bytes)
```json
{
  "v": 1,
  "ssid": "VenueWiFi",
  "pwd": "password123",
  "url": "wss://babel.live/ws",
  "code": "CONF2026",
  "lang": "en"
}
```
Fits in one extended advertising packet. No fragmentation needed.

#### Provisioning Flow

```
Staff tablet app
    │
    ├─ Enter "provision event" mode
    ├─ Input: WiFi SSID, password, event code, default language
    │
    └─ BLE: start extended advertising with payload
            Service UUID: 0xBABE (Babel custom)
            Manufacturer data: encoded config payload

Device (in provisioning mode)
    │
    ├─ Scanning for service UUID 0xBABE
    ├─ Receives advertisement → decode payload
    ├─ Verify checksum/version
    ├─ Write to NVS: ssid, pwd, event_url, event_code, lang
    ├─ Display: "✓ Provisioned — ready"
    └─ Reboot into stream mode (or await power-off)
```

Range: ~30–50m. For 400 devices in a room: staff broadcasts from center of room, all devices receive within seconds.

#### Re-provisioning
- Any device can be re-provisioned by broadcasting new config
- Devices accept re-provision if UUID matches and payload version ≥ current
- Unit ID (burned into NVS at manufacture, e.g. `BABEL-0247`) never overwritten

---

## 6. Anti-Theft System

### Layer 1 — Physical
- Laser-etched unit ID on housing (e.g. `BABEL-0247`)
- Manual count sheet at venue door — no tech dependency

### Layer 2 — BLE Beacon Sweep

Device continuously advertises (even while streaming):
```
BLE advertisement payload:
  Service UUID:    0xBABE
  Manufacturer:    [unit_id: uint16] [battery_pct: uint8] [stream_state: uint8]
```

Staff tablet app "sweep mode":
- Scans for 0xBABE advertisements
- Builds list: Unit ID | Battery | Status | Signal strength (RSSI)
- Highlights units not seen in last 30s as "missing"
- Shows expected count vs. detected count

### Layer 3 — WiFi-Loss Alarm

```c
// Watchdog in net_task
if (wifi_disconnected_ms > ALARM_THRESHOLD_MS) {
  gpio_set_level(BUZZER_PIN, 1);  // beep pattern
}
```
- Default threshold: 5 minutes (configurable via provisioning payload)
- Alarm pattern: 3 beeps every 30 seconds
- Cancels when WiFi reconnects
- Prevents false alarm during legitimate reconnect backoff window

---

## 7. Provisioning App — Interface Spec (deferred build)

> Staff tablet app (iOS/Android React Native or Flutter)

### Screens

**1. Event Setup**
- Inputs: WiFi SSID, WiFi password, Babel event code, default language
- Action: "Broadcast config" → starts BLE extended advertising
- Status: "Broadcasting... devices will auto-configure"

**2. Fleet Sweep**
- Action: "Start sweep" → BLE scan for 0xBABE beacons
- List view: Unit ID | Battery % | Status | Last seen
- Counter: "387 / 400 devices detected"
- Filter: "Show missing only"

**3. Fleet Inventory**
- Total units in this deployment
- Units at low battery (<20%)
- Units not seen in current sweep

---

## 8. Charging Case Design

**Target:** Rack-style case, 25–50 units per case, 8–16 cases for full 400-unit fleet.

| Spec | Target |
|---|---|
| Units per case | 25–50 |
| Charge connector | USB-C per slot, 5V/1A minimum |
| Power input | IEC C14 to 20-port USB hub per case, or individual adapters |
| Slot design | Friction-fit slot, USB-C tail pigtail per slot |
| Charge time | 4000mAh @ 1A = ~4.5 hours from 0% |
| Case material | ABS/PC, stackable, foam lining |
| Transport | Pelican-style latching carry case outer shell |

Full fleet overnight charge: plug all cases into standard multi-socket power strip. No exotic infrastructure.

---

## 9. Prototype Development Path

Build Pro first — larger display is easier to develop LVGL layouts on. Lite follows with a display config swap.

### Phase 0 — Audio pipeline proof of concept (Week 1–2)
- Pro board + PCM5102A on breadboard
- Firmware: WiFi → WebSocket → binary audio → I2S → 3.5mm
- Goal: confirm latency, audio quality, and ring buffer sizing

### Phase 1 — Firmware complete, Pro (Week 3–4)
- Full state machine: provisioning → stream → reconnect
- LVGL UI on 4.3" landscape: stream screen + lang picker + error screen
- BLE beacon advertising + provisioning listener
- A2DP Bluetooth audio (neckloop test)

### Phase 2 — Firmware complete, Lite (Week 4–5)
- Swap display driver to 2.8B portrait config
- LVGL portrait layout (caption code compiled out)
- Validate same boot-to-stream time on Lite board

### Phase 3 — Housing prototypes (Week 5–7)
- 3D-printed housings for both tiers
- Panel-mount 3.5mm jack at top, USB-C passthrough
- 12h battery life test on both under continuous stream load

### Phase 4 — Fleet provisioning test (Week 7–8)
- Staff tablet app (React Native + Expo): broadcast config + BLE sweep
- Test with 10 units simultaneously provisioned
- Validate < 2s boot-to-stream time across both tiers

### Phase 5 — Pilot event (Week 9+)
- 20–50 unit mixed-tier deployment
- Collect real-world battery, range, audio, and UX data
- Iterate before scaling to 400

---

## 10. Resolved Design Decisions

| # | Decision | Resolution |
|---|---|---|
| O1 | Waveshare USB-C charging | ✓ USB-C charges via onboard CS8501 chip. Board recommends <2000mAh — **fix: replace R45 resistor for 1A charge current, use 5000mAh LiPo**. Charge time ~5h overnight. See battery revision below. |
| O2 | Audio format | ✓ **Mono PCM16 @ 48kHz.** Bandwidth saving over stereo. Worker fan-out sends mono frames. I2S configured as mono; A2DP duplicates mono to both SBC channels. |
| O3 | Firmware language | ✓ **Arduino framework (C++).** Faster to develop than bare ESP-IDF C, nearly identical runtime efficiency, excellent ESP32-S3 ecosystem (WiFi, BLE, I2S, LVGL all well-supported). MicroPython ruled out — too heavy for real-time audio DMA. |
| O4 | Staff tablet app | ✓ **React Native + Expo.** Team already knows TypeScript + React. BLE via `react-native-ble-plx`. PWA ruled out — Web Bluetooth not supported on iOS Safari. |
| O5 | Unit ID + NVS layout | ✓ See Section 11 below. |
| O6 | 3.5mm jack placement | ✓ **Top of device.** Earbuds hang down naturally when seated. Less leverage on connector than side placement. |

### Battery Revision (from O1)

Replace 4000mAh with **5000mAh LiPo + R45 mod for 1A charge current**:

| | Original | Revised |
|---|---|---|
| Battery | 4000mAh | 5000mAh |
| Charge current | 580mA (default) | 1000mA (R45 swap) |
| Charge time | 6.9h | 5.0h |
| Runtime @ 368mA draw | 10.9h | 13.6h |
| BOM delta | — | +$2 |

---

## 11. Unit ID Scheme + NVS Layout

### Unit ID Format

```
BABEL-XXXX
```
- `XXXX` = zero-padded decimal, 0001–9999
- Laser-etched on housing at manufacture
- Also stored in NVS and included in BLE beacon payload
- Example: `BABEL-0001`, `BABEL-0247`, `BABEL-0400`

### NVS Namespace: `"babel"`

| Key | Type | Max size | Description | Writable |
|---|---|---|---|---|
| `unit_id` | string | 12 bytes | `BABEL-XXXX` — burned at manufacture | Never |
| `wifi_ssid` | string | 32 bytes | WiFi network name | Provisioning |
| `wifi_pwd` | string | 64 bytes | WiFi password | Provisioning |
| `ws_url` | string | 128 bytes | `wss://babel.live/ws` | Provisioning |
| `event_code` | string | 16 bytes | e.g. `CONF2026` | Provisioning |
| `def_lang` | string | 8 bytes | BCP-47 code, e.g. `es` | Provisioning |
| `alarm_ms` | uint32 | 4 bytes | WiFi-loss alarm threshold ms (default 300000) | Provisioning |
| `prov_ver` | uint8 | 1 byte | Provisioning version counter — reject older payloads | Provisioning |
| `fw_ver` | string | 16 bytes | Firmware version — set by OTA | System |

### Manufacture Flash Sequence

When flashing a new unit:
1. Flash firmware
2. Write `unit_id` to NVS (unique per device, matches laser etch)
3. Write `prov_ver = 0`
4. All other keys: empty (device boots into provisioning mode)

### Provisioning Payload (BLE advertisement → NVS write)

```json
{
  "v": 2,
  "ssid": "VenueWiFi",
  "pwd":  "password123",
  "url":  "wss://babel.live/ws",
  "code": "CONF2026",
  "lang": "es",
  "alarm_ms": 300000
}
```

Device accepts payload only if `v >= prov_ver`. After write: `prov_ver = v`.
