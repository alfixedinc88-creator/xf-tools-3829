# Scanners: known problems and fixes

Read this first when the owner says a scanner "stopped working". These are
device settings, not app bugs. The owner asked that this be kept so nobody has
to remember it.

## N77 handheld (Android, built-in scanner, "Setting" app)

The scanner settings are in the N77's own **Setting** app (bottom tabs:
Test Scan / Setting / about). They are not in the Android phone settings.

Working settings (confirmed by the owner 2026-10-05):

| Setting | Must be | Why |
|---|---|---|
| Enable Scanner | ON | |
| Output Mode | Keyboard Mode | types the barcode into our app's box |
| **Configure the post-scan action** | **Carriage Return** | a single Enter, so our app searches / saves by itself |
| Output Format (bottom of list) | Character | Hex turns barcodes into code numbers, never use it |
| Add a suffix | empty | otherwise Enter is pressed twice |
| **Setting Handle Key** | **Only Scan** | "Scan And UHF" shares the gun trigger with the RFID reader |
| Center Key | ON (Left / Right Key OFF) | |

### Problem: scan types the number but the app doesn't search or save (no auto Enter)
- Cause: post-scan action is NONE, or **Carriage Return and Line Feed**.
  Chrome doesn't count CR+LF as an Enter press, and our scan boxes wait for
  Enter (`onkeydown … event.key==='Enter'`).
- Fix: post-scan action → **Carriage Return** → OK. Not Tab, not CR+LF.

### Problem: gun trigger dead after the N77 is turned off/on (had to toggle the setting off/on each time)
- Cause: Setting Handle Key was "Scan And UHF".
- Fix: Setting Handle Key → **Only Scan**, then restart and test.
- If it still happens: the scanner isn't keeping its settings after a
  restart. Ask the seller for a firmware update (the "about" tab shows the
  version). "Reset scanner" puts everything back to factory, so photograph
  every setting first and set the table above again afterwards.

## Zebra Symbol DS2278-SR (wireless, with cradle)

### Problem: no light, no beep at all
1. Make sure the cradle cable is plugged in, then leave the scanner in the
   cradle for 3–4 hours (a completely empty battery takes a while to wake up).
2. Still dead: open the screw cover at the bottom of the handle, take the
   battery out, wait 10 s, put it back, charge again.
3. Still dead: the battery is worn out (2–3 years). The replacement is
   **Zebra BTRY-DS22EAB0E-00**.

### Problem: lights and beeps but nothing is typed into the app
- It lost the link to its cradle. Scan the pairing barcode printed on the
  cradle.

## Farset R20H (Android, built-in scanner, "Scanner Settings" / "Scan Tool")

Settings are in its **Scanner Settings** app (the Scan Tool app's SCAN SETTING
opens the same). **Working (confirmed by the owner 2026-10-06):** Enable
Scanner ON, **Send Mode = EMUKEY**, End Char Setting **ENTER**, Prefix /
Suffix empty.

### Problem: scans don't show up in our app at all (Scan Tool shows them fine)
- Cause: Send Mode was **FOCUS + BROADCAST**. FOCUS goes through the phone
  keyboard and doesn't work with Chrome (Scanner test: only F10 + Enter, no
  numbers; with a box selected nothing at all), and it forces the phone
  keyboard open. BROADCAST only reaches apps, not websites.
- Fix: Scanner Settings → OUTPUT SETTING → **Send Mode Setting → EMUKEY**
  (emulates key presses). Then the app catches the scan with no box selected. Barcode types:
Bar Setting → Enable/Disable (all the common ones are on from the factory).

### Problem: part # labels scan, outside box UPC "doesn't work"
- Cause: the R20H sends a UPC-A **without its first digit**: box
  `810097207059` arrives as `10097207059` (seen in its Scan Tool, 2026-10-06).
- Fixed in the app (2026-10-06): 11 digits whose check digit only works with
  a first digit 1–9 get that digit put back (`xfFixUpc` in xf-access.js, and
  `upcAddFirstDigit` in the Worker). Exactly one digit fits, so it's never a guess.
- Device fix too, if wanted: Bar Setting → Advanced Configuration → UPC-A →
  turn on "transmit system digit / preamble" (name varies).

### How the R20H sends a scan (its 🔍 Scanner test, 2026-10-06)
- The trigger sends **F10** (keyCode 121), repeated while held. F10 = Chrome's
  menu, which is why the menu popped up.
- Send Mode FOCUS puts the number **only into the box with the cursor**, then
  an Enter. With no box selected the number is lost (only Enter arrives).
- App fix (xf-access.js): F10 is blocked, and it puts the cursor in the scan
  box (keyboard stays off) before the number arrives.

### Problem: Chrome menu pops up on a scan, then nothing types into the app
- The scan landed while the box had no cursor. Close the menu, tap the scan
  box, scan again. If still nothing: restart the R20H.
- Test the scanner itself in **Scan Tool** (it lists every scan): if it shows
  there, the scanner is fine.

## Phone keyboard
Never opens on a touch screen (owner, 2026-10-06: "get away of the keyboard
forever"), sign-in boxes included. Scans still go in. To type: tap the box,
then ⌨️ (bottom left) → "Type in this box" opens OUR on-screen keyboard
(sign-in boxes open it by themselves). A page's ⌨ "type it" button opens it too.

A scan that arrives with no box selected (cursor on a button) goes to the scan
box used last (or the page's 📷 box). Not into sign-in boxes, not behind a pop-up.

## New scanner? ⌨️ → 🔍 Test the scanner
Shows every key / text the scanner sends, with "cursor: nothing" / "box".
- Nothing shows at all → the scanner isn't sending to Chrome (check its send /
  output mode: pick keyboard / keystroke emulation if offered).
- Shows only with "Cursor in a box" → fine (the app keeps a box selected).
- Numbers show but a digit is missing → compare with the printed number.

## R20H: no phone keyboard at all + no address bar (owner, 2026-10-06)
- Phone keyboard: installed **Null Keyboard** (Play Store) and set it as the
  default keyboard (Settings → System → Keyboard). Scans (EMUKEY) still work;
  typing in our app uses our own ⌨️ keyboard. To undo: set the default back to
  Android Keyboard (AOSP).
- No address bar: open the app in Chrome → ⋮ → **Install app** (or Add to
  home screen → Install). The installed app opens without the address bar
  (manifest.json, display standalone). A plain Chrome shortcut keeps the bar.
