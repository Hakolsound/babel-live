# Babel Listener — Procurement Sheet

**Date:** 2026-05-13  
**Tiers:** Lite (2.8") + Pro (5")  
⚠ = requires attention before ordering

---

## Boards

| Item | Tier | Link | Est. Price |
|---|---|---|---|
| Waveshare ESP32-S3-Touch-LCD-2.8B | Lite | [waveshare.com](https://www.waveshare.com/esp32-s3-touch-lcd-2.8b.htm) | ~$18 |
| Waveshare ESP32-S3-Touch-LCD-5 | Pro | [waveshare.com](https://www.waveshare.com/esp32-s3-touch-lcd-5.htm) | ~$32 |

> ⚠ **Pro board R45 mod required** — replace R45 resistor to raise charge current to 1A before connecting the 6000mAh battery.

---

## Custom Peripheral PCB

All peripheral components are consolidated onto a single custom 2-layer PCB, manufactured and assembled by JLCPCB.

**Chips to source for PCB (DigiKey / Mouser / LCSC):**

| Chip | Package | Tier | DigiKey search | Est. unit price |
|---|---|---|---|---|
| PCM5102A (TI) | TSSOP-20 | Both | `PCM5102APWR` | ~$2 |
| TPA6130A2 (TI) | DQFN-16 (RTJ) | Both | `TPA6130A2RTJR` | ~$2 |
| LIS3DH (ST) | LGA-16 3×3mm | Pro only | `LIS3DHTR` | ~$1.50 |

> PCB fabrication + JLCPCB SMD assembly (all chips + passives): ~$8/unit at 10-unit quantity.  
> Through-hole components (jack, buttons, pogo pins) hand-soldered after assembly.

**Passive components (on PCB — standard values, any supplier):**
- 4× 100nF decoupling caps (PCM5102A, TPA6130A2 supply)
- 2× 4.7µF output coupling caps (TPA6130A2)
- 2× 10kΩ I2C pull-up resistors (SDA/SCL)
- 1× 100kΩ + 1× 10kΩ voltage divider (LIS3DH INT threshold, Pro only)

---

## Battery

| Item | Tier | Link | Est. Price | Dimensions |
|---|---|---|---|---|
| AKZYTUE 3.7V 6000mAh LiPo — PH2.0 connector | Pro | [Amazon](https://www.amazon.com/AKZYTUE-Lithium-Rechargeable-Connector-Wireless/dp/B0FR99XQ8F) | ~$14 | 90×60×9mm |
| AKZYTUE 3.7V 4000mAh LiPo — JST connector | Lite | [Amazon](https://www.amazon.com/AKZYTUE-4000mAh-6050100-Rechargeable-Connector/dp/B07TXJCCY8) | ~$9 | 100×50×6mm |

> ⚠ **Verify connector polarity before connecting.** Reverse polarity destroys the board instantly.  
> ⚠ Confirm battery dimensions fit housing before finalising PCB layout.

---

## Through-Hole / Panel Components (hand-soldered onto PCB)

| Item | Tier | Link | Est. Price |
|---|---|---|---|
| Philmore 70-539 — 3.5mm TRRS 4-pole panel mount jack | Both | [Amazon](https://www.amazon.com/Philmore-3-5mm-Conductor-Chassis-70-539/dp/B015GFB304) | ~$2 |
| Hilitchi 6×6mm tactile button assortment (200-pack) | Both | [Amazon](https://www.amazon.com/Hilitchi-200-Pcs-Tactile-Momentary-Assortment/dp/B071KX71SV) | ~$8 (pack) |
| Passive piezo buzzer 3V SMD (20-pack) | Both | [Amazon](https://www.amazon.com/Electromagnetic-Piezo-Buzzer-Continous-Continuously/dp/B00OHBI67M) | ~$6 (pack) |
| Pogo pin receptacles (charging contacts +/−) | Both | Search: "Mil-Max 0906" or "spring loaded pogo pin receptacle PCB 2.54mm" | ~$2 (pair) |

> **Buttons:** 2 per device (A = Up, B = Down). Short press = language change. Long press = volume change.  
> **TRRS jack:** top edge of PCB, panel-mount through housing wall.  
> **Pogo pins:** bottom edge of PCB, exposed through housing for case charging dock contact.

---

## Per-Unit BOM Cost Summary

| Component | Lite | Pro |
|---|---|---|
| Waveshare board | $18 | $32 |
| Custom peripheral PCB (assembled) | $8 | $8 |
| Quality LiPo battery | $9 (4000mAh) | $14 (6000mAh) |
| 3D-printed housing (prototype) | $4 | $6 |
| Misc (headers, connectors, wire) | $2 | $2 |
| **Total** | **~$41** | **~$62** |

---

## Prototype Quantities (10-unit pilot build)

| Item | Qty | Notes |
|---|---|---|
| Lite boards | 5 | |
| Pro boards | 5 | |
| Peripheral PCBs (assembled) | 12 | 2 spare |
| 6000mAh LiPo | 6 | 1 spare |
| 4000mAh LiPo | 6 | 1 spare |
| Philmore TRRS jack | 15 | 5 spare |
| Tactile button kit | 1 | 200-pack covers all |
| Buzzer pack | 1 | 20-pack covers all |
| Pogo pin pairs | 15 | 5 spare |
