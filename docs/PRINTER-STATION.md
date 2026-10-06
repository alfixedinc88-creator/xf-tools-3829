# Auto Label printer station — setup and "labels not printing"

Auto Label buys labels by itself on the server, but the server can't reach a
printer. Labels and packing slips print from **one computer with Pack & Ship
open** (the "🖨 Printer station"). It checks for new ones every minute.

## Setup (Windows, done once)
1. **Printer**: install the label printer's driver and print its test page.
   In Windows Settings → Bluetooth & devices → Printers & scanners:
   - turn OFF "Let Windows manage my default printer";
   - click the label printer → **Set as default**;
   - open Printing preferences and set the paper to **4 × 6 in**.
2. **One print by hand** so Chrome remembers the settings: Pack & Ship →
   Auto Label → 🏷️ Shipping labels → Reprint any label. In the print window
   choose:
   - Destination: the label printer
   - Paper: 4×6
   - Margins: None
   - Scale: 100%
   - Headers/footers: off
3. **No print pop-up**: close EVERY Chrome window (right-click the Chrome icon
   by the clock → Exit). Then make a desktop shortcut named **Label Station**:
   `"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing https://<app address>/packship.html`
   Always open Chrome on that computer with this shortcut. Optional: copy the
   shortcut into `shell:startup` (Win+R) so it opens when the computer starts.
4. **Tick 🖨 Printer station (this computer)** once in Auto Label → Packing
   slips. It stays ticked on that computer.
5. **Keep it awake**:
   - Windows Settings → System → Power → Screen and sleep: **Never**.
   - Chrome Settings → Performance → Memory saver → "Always keep these sites
     active": add the app address.

## How it runs (since 2026-10-06)
- The station starts by itself when Pack & Ship opens, on **any tab**
  (e.g. Print Log on the second screen). Nobody needs to open Auto Label.
- A **green bar** at the bottom-left says "🖨 Printer station ON · checked <time>".
  No green bar means it isn't printing.
- Two Pack & Ship windows on that computer: only ONE prints. The other shows
  a grey bar "printing in the other Pack & Ship window" and takes over within
  about 90 s if the first one is closed. Labels never print twice.

## Labels not printing? Check in this order
1. Is the green bar there? If not, Pack & Ship isn't open on that computer, or
   the station is unticked.
2. The print pop-up shows: Chrome wasn't fully closed before opening the
   Label Station shortcut. Exit Chrome completely and use the shortcut again.
3. The label is tiny or cut off: redo step 2 of the setup (4×6, no margins, 100%).
4. Auto Label shows "⚠ labels waiting, and no printer station is printing":
   the station computer is asleep, closed, or signed out.
5. A label shows "✗ Not printed": tap Print on it to see what Veeqo said.
