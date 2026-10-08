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

## 🛑 Print watch: labels not picked up (since 2026-10-08)
Every label that prints should be read by the fixed **Print Log** scanner
within a few minutes. Auto Label → **🛑 Print watch** checks this:
- A label printed but not read within ~3 minutes is **"not picked up"**. It
  stays on the list (last 48 h) until it is reprinted and read, or someone taps
  **✓ Checked** (with a note: found it / reprinted in Veeqo / cancelled …).
- **3 in a row** not picked up (set 2–5 on the card) → **printing ON HOLD**:
  the printer station prints nothing more. Auto Label keeps buying, and the
  labels wait in 🏷️ Shipping labels. The station bar turns red and says
  "Label printer needs checking" every 5 minutes. Every manager's Pack & Ship
  shows a red bar at the top (orange when only some labels are not picked up).
- Fix the printer (paper jam, out of labels, printer off, or the Print Log box
  not open / focused on that computer). Then tap **✅ Printer fixed — print
  again**. Waiting labels print within a minute, and **🔁 Reprint** (or
  **Reprint all**) the ones not picked up.
- Hold, "printer fixed" and every ✓ Checked are saved in the Auto Label log
  (who / when).

## 📄 USPS scan forms on the regular (ink) printer, 8.5 × 11 (owner, 2026-10-08)
Scan forms are letter-size paper on the ink printer, labels are 4×6 on the label
printer. A Chrome window opened with `--kiosk-printing` always prints to the
printer it printed to last, so one window can't do both. Use a **second Chrome
window with its own profile** on the same computer (xfitting3):
1. Desktop → New → Shortcut:
   `"C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="C:\ScanFormStation" --kiosk-printing https://<app address>/packship.html`
   Name it **Scan Form Station**. (`--user-data-dir` = a separate Chrome, so it
   remembers its own printer; the Label Station keeps the label printer.)
2. Open it, sign in, Pack & Ship → 🤖 Auto Label → 📄 USPS scan form.
   Tick **📄 Scan form station** here. Do **not** tick 🖨 Printer station in
   this window (that stays only in the Label Station window).
3. **One print by hand** so it remembers the ink printer: Reprint any scan form
   (or Ctrl+P on any page) and choose: Destination = the ink printer, Paper =
   Letter (8.5 × 11), Margins = Default, Scale = Fit to page / 100%. The first
   time the print window still shows: close this window completely and open it
   again with the shortcut, then it prints with no pop-up.
4. Copy this shortcut into `shell:startup` too, so both windows open when the
   computer starts.
- In the **Label Station** window, leave 📄 Scan form station **unticked** (a
  scan form there would come out on the label printer).
- Scan forms print by themselves at the set times (Auto Label → 📄 Schedule).
  🚚 Leaving for USPS still asks to print them on whatever computer taps it.
