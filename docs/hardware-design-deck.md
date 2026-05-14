# Babel Listener — PCB & Case Design Deck

**Date:** 2026-05-13  
**Covers:** Listener Lite (2.8") + Listener Pro (5")  
**Audience:** PCB designer, enclosure designer, housing manufacturer

---

## 1. Product Overview

Babel Listener is a dedicated wireless translation receiver deployed at live events — conferences, houses of worship, medical briefings. Attendees pick it up at the door, power it on, select a language on the touchscreen, and hear a real-time translated audio feed through their earbuds or Bluetooth neckloop. No phone, no app, no setup.

Babel owns and manages the fleet. Devices are provisioned before each event by staff, charged overnight in a rack case, and collected at the end of the event.

---

## 2. Two-Tier Summary

| | **Listener Lite** | **Listener Pro** |
|---|---|---|
| Display | 2.8" IPS 480×640 portrait | 5" IPS 1024×600 portrait |
| Captions | No | Yes (auto-orientation) |
| Primary use | Audio-only events, large volume deployments | Premium events, caption-heavy content |
| Target BOM | ~$41 | ~$62 |
| Device size | ~6.5 × 8.5 × 1.5cm | ~8.0 × 11.5 × 1.9cm |

Both tiers share the same peripheral PCB design, firmware codebase, charging case system, and provisioning workflow. The peripheral PCB is the subject of this deck.

---

## 3. Use Cases & User Journey

### Attendee
1. Picks up device from rack at venue entrance — no instruction needed
2. Powers on — device auto-connects to WiFi and stream within 2 seconds
3. Selects language on touchscreen
4. Plugs in earbuds (3.5mm top jack) or pairs Bluetooth neckloop
5. Adjusts volume with side buttons during the event
6. Returns device to rack at the end — drops into charging slot

### Babel Staff (pre-event)
1. Removes device stack from transport case
2. Broadcasts WiFi + event config to all devices simultaneously via tablet app
3. Stacks devices back into charging case — pogo pins contact charging rails automatically
4. At event end: sweeps room with tablet app to detect unreturned units

### Babel Staff (maintenance)
1. Connects USB-C (bottom) for firmware update
2. Monitors charge indicator LED (top) per slot without opening case

---

## 4. Design Goals

| Goal | Rationale |
|---|---|
| **Zero-friction pickup** | Attendees must not need any instruction. Device on → ready in 2s. |
| **Durability** | Fleet devices handled by hundreds of different people per month. No exposed fragile parts. |
| **Idiot-proof charging** | Drop into slot → contacts align → charges. No cable hunting in the dark. |
| **Clean single-hand use** | Held in one hand while seated. Two side buttons reachable with thumb. |
| **Lanyard + clip** | Attendees may want hands-free carry. Both options available. |
| **Visual charge status** | Staff can verify charging state per device from a distance, without touching. |
| **Serviceable** | PCB and battery replaceable without destroying the housing. |

---

## 5. System Architecture

```
┌─────────────────────────────────────────────────────┐
│                    HOUSING                           │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │           WAVESHARE MAIN BOARD               │   │
│  │   ESP32-S3 + Display + WiFi/BLE + Battery    │   │
│  │   connector                                  │   │
│  └────────────────┬─────────────────────────────┘   │
│                   │ Pin header / FFC                 │
│  ┌────────────────┴─────────────────────────────┐   │
│  │           PERIPHERAL PCB                     │   │
│  │                                              │   │
│  │  [TOP]    TRRS jack · LED light pipe exit    │   │
│  │  [SIDE]   Button A · Button B                │   │
│  │  [BOTTOM] Pogo +/− · USB-C port              │   │
│  │  [INTERNAL] PCM5102A · TPA6130A2 · LIS3DH*  │   │
│  │             Piezo buzzer · Passives          │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  [BACK]  Belt clip rail groove                       │
│  [TOP CORNER]  Lanyard hole                          │
└─────────────────────────────────────────────────────┘
* LIS3DH on Pro only
```

---

## 6. Peripheral PCB Specification

### 6.1 Board Role
The peripheral PCB is a companion board that attaches beneath the Waveshare main board. It handles all physical I/O (audio, buttons, charging contacts, status LED) and audio signal processing, keeping the main board unmodified and replaceable.

### 6.2 Electrical Interface to Main Board
- **Connector:** FFC/FPC — ZIF connector on both peripheral PCB and main board side
- **Signals:** I2S (BCLK, LRCLK, DIN) · I2C SDA/SCL · 4× GPIO (Button A, Button B, Buzzer, LIS3DH INT1) · 3.3V · GND
- **Cable:** 0.5mm pitch FFC, length TBD by board stack height (~20–30mm)
- **Mechanical:** Separate mechanical standoffs for board-to-board alignment (FFC carries signals only)

### 6.3 Components on PCB

| Component | Package | Qty | Notes |
|---|---|---|---|
| PCM5102A DAC | TSSOP-20 | 1 | I2S from ESP32-S3 |
| TPA6130A2 headphone amp | DQFN-16 (RTJ) | 1 | I2C vol ctrl, line-in from PCM5102A |
| LIS3DH IMU | LGA-16 3×3mm | 1 (Pro) | I2C, INT1 to ESP32 GPIO |
| 3.5mm TRRS jack | Panel mount | 1 | Top edge |
| Tactile button 6×6mm | SMD | 2 | Side edge (left or right) |
| Passive piezo buzzer | SMD 12×9.5mm | 1 | Internal, no housing cutout needed |
| Charge indicator LED | SMD 0402 red/green | 1 | Light pipe routes to top surface |
| Pogo pin receptacles (+/−) | Through-hole | 2 | Bottom edge |
| USB-C port | SMD/through-hole | 1 | Bottom edge, adjacent to pogo pins |
| Pin header (main board interface) | 2.54mm | 1 | Matches Waveshare board GPIO layout |
| Decoupling caps, pull-ups, passives | 0402 | ~15 | Standard values |

### 6.4 Port & Component Placement Map

```
                    TOP EDGE
    ┌───────────────────────────────┐
    │  [TRRS JACK]   [LED LIGHTPIPE]│  ← audio out + charge indicator
    │                               │
S   │  [BTN A ▲]                   │  S
I   │                               │  I
D   │  [BTN B ▼]                   │  D
E   │                               │  E
    │  PCM5102A   TPA6130A2         │
    │  LIS3DH*    PIEZO             │
    │                               │
    │  [POGO +]  [POGO −]  [USB-C] │  ← charging + firmware
    └───────────────────────────────┘
                  BOTTOM EDGE

* Pro only
```

### 6.5 PCB Specs
- **Layers:** 2 (FR4)
- **Thickness:** 1.6mm
- **Surface finish:** HASL or ENIG (ENIG preferred for pogo pin pads — better wear resistance)
- **Solder mask:** Black both sides
- **Silkscreen:** White top only
- **Size:** Match housing footprint minus wall thickness (~2mm inset per edge)
- **Fabrication + SMD assembly:** JLCPCB (PCM5102A, TPA6130A2, LIS3DH, buzzer, passives pre-assembled)
- **Hand-solder:** TRRS jack, buttons, pogo pins, USB-C port, pin header

---

## 7. Case Design Specification

### 7.1 Lite — 2.8" Portrait Slab

**Overall dimensions:** ~65 × 85 × 15mm  
**Orientation:** Portrait (tall narrow), held in one hand

```
        65mm
    ┌──────────┐
    │ ◉ lanyard│  ← top-left corner, 3mm hole
    │ ─────    │
    │ [ jack ] │  ← TRRS cutout top-center
    │  ● LED   │  ← charge indicator, top-right inset
    │          │
  8 │          │ 8
  5 │  DISPLAY │ 5
  m │  2.8"    │ m
  m │          │ m
    │ ◄ btn A  │  ← button A, right side, 20mm from top
    │ ◄ btn B  │  ← button B, right side, 35mm from top
    │          │
    │ ─────────│
    │[+][−][⚡]│  ← pogo pins + USB-C, bottom edge
    └──────────┘
         ↑
    [clip rail]   ← groove on back, full-width, 10mm from bottom
```

### 7.2 Pro — 5" Portrait Slab

**Overall dimensions:** ~80 × 115 × 19mm  
**Orientation:** Portrait default (primary hold), auto-rotates to landscape for caption reading only

```
        80mm
    ┌──────────────┐
    │◉ [ jack ] ●  │  ← lanyard top-left · jack top-center · LED top-right
    │              │
    │              │ ← btn A (right side, 30mm from top)
  1 │  DISPLAY 5"  │
  1 │              │ ← btn B (right side, 47mm from top)
  5 │              │
  m │              │
  m │              │
    │──────────────│
    │ [+][−] [USB] │  ← pogo + USB-C, bottom edge
    └──────────────┘
          ↑
     [clip rail]   ← groove on back, vertical center, full-height
```

> **Pro orientation note:** Portrait is the natural single-hand listening hold — buttons on the right edge are reachable by thumb. Landscape is triggered automatically by LIS3DH when the user rotates the device to read captions; UI reflowing to full-width caption layout. Buttons in landscape land on the bottom edge, reachable by index finger. Charging dock and pogo pins are always at the physical bottom edge of the housing in portrait orientation.

### 7.3 Materials

| Part | Material | Notes |
|---|---|---|
| Front shell | PC/ABS blend | Matte finish, display window cut |
| Back shell | PC/ABS blend | Clip rail groove, lanyard hole |
| Display lens | 2mm tempered glass, optically bonded | OCA adhesive, no air gap — PCAP touch works through 2mm glass |
| Buttons | TPU or ABS caps | Slight tactile dome protrusion, 1.5mm travel |
| Pogo pin cover | None — exposed contacts | Recessed 0.5mm into housing to prevent shorting on metal surfaces |
| Belt clip | Glass-filled nylon, slim profile | Ships attached; slides into back rail groove; removable |

### 7.4 Assembly Method
- **2-piece clamshell** (front + back shell) joined by 4× M2 screws at corners
- Screws accessible from back — Torx T6 (tamper-resistant for fleet devices)
- Battery and peripheral PCB accessible without tools once screws removed
- Main Waveshare board accessible by lifting peripheral PCB off header

### 7.5 Display Window
- Tempered glass panel glued into front shell with optical adhesive (no air gap = better readability)
- 0.5mm inset bezel around display active area
- Glass covers top edge port area — TRRS jack and LED exit through holes in glass surround, not through glass itself

### 7.6 Housing Cutouts Summary

| Location | Cutout | Size | Notes |
|---|---|---|---|
| Top edge | TRRS jack | Ø3.8mm | Center of top edge |
| Top edge | LED light pipe exit | Ø1.5mm | Right of jack, or top-right corner |
| Top corner | Lanyard hole | Ø3mm with metal eyelet | Top-left corner |
| Side (right) | Button A | 7×7mm slot | Slight chamfer for finger feel |
| Side (right) | Button B | 7×7mm slot | 15mm below Button A |
| Bottom edge | Pogo pins | 2× Ø2.5mm recessed | 10mm spacing |
| Bottom edge | USB-C port | 9×3.5mm | Adjacent to pogo pins |
| Back | Belt clip rail groove | Full-width, 8×3mm channel | 10mm from bottom edge |

---

## 8. Charging Case Interface

The pogo pins on the device bottom mate with spring contacts on the charging case slot rails. No alignment required beyond gravity + slot friction.

```
DEVICE BOTTOM
  [+]  [−]  [USB-C]
   ↕    ↕
  (spring contacts on case rail)
CASE SLOT
```

- Pogo pin pitch: 10mm center-to-center
- Contact material: gold-plated copper on PCB pad
- Case spring contacts: brass pogo pins, 1A rated, 2mm stroke
- USB-C remains accessible (not blocked by case slot) for firmware updates while in case

---

## 9. Power Button

**Resolved: expose main board button through housing cutout (both tiers).**

- Housing has a precise cutout aligned to the Waveshare board's onboard power button position
- A slim TPU or ABS button cap bridges the gap between housing surface and board button (same as side buttons)
- Enclosure designer must confirm button position from Waveshare board datasheet/3D model before cutting
- If alignment proves infeasible during prototype: fall back to Option B (replicate on peripheral PCB, 3rd tactile button)

---

## 10. Charge Indicator LED

- 1× dual-color SMD LED (red/green, 0402) on peripheral PCB
- Red = charging, Green = full, Off = no power
- Light pipe (3mm clear acrylic rod or molded-in housing channel) routes from LED on PCB to exit hole at top of housing
- Staff can verify charge state of each device in the rack without touching it

---

## 11. Lanyard & Clip

| Accessory | Implementation |
|---|---|
| Lanyard | 3mm metal eyelet pressed into top-left corner hole. Standard conference lanyard loop compatible. |
| Belt clip | Glass-filled nylon clip slides into back rail groove. Removable. Holds device vertically on belt or bag strap. |

---

## 12. Design Decisions — All Resolved

| # | Decision | Resolution |
|---|---|---|
| D1 | Power button | ✓ **Expose main board button through housing cutout** — verify alignment feasibility during PCB layout; less complex, no extra components |
| D2 | Pro button placement | ✓ **Bottom edge** — thumb-reachable in landscape; lands on right side in portrait; works both orientations |
| D3 | Peripheral PCB connector | ✓ **FFC/FPC** — lower profile, production-ready; use ZIF connector on both boards |
| D4 | Housing assembly | ✓ **Clamshell screws** — Torx T6 tamper-resistant M2 at 4 corners; battery and PCB accessible after removal |
| D5 | Display lens | ✓ **2mm tempered glass, optically bonded (OCA adhesive), both tiers** — PCAP touch works through 2mm glass |
| D6 | Belt clip | ✓ **Included, minimal design** — slim glass-filled nylon clip slides into back rail groove; ships attached |

---

## 13. Deliverables Checklist

**PCB designer needs:**
- [ ] Waveshare ESP32-S3-Touch-LCD-2.8B GPIO pinout (for header mapping)
- [ ] Waveshare ESP32-S3-Touch-LCD-5 GPIO pinout (for header mapping)
- [ ] Confirmed housing footprint dimensions (PCB must fit within)
- [ ] Pogo pin model selected (for footprint)
- [ ] Decision on D1 (power button)

**Enclosure designer needs:**
- [ ] Final PCB layout (port positions locked)
- [ ] Battery dimensions confirmed (affects internal stack height)
- [ ] Decision on D2 (Pro button placement)
- [ ] Decision on D5 (lens material)
- [ ] Belt clip design brief (if included)
