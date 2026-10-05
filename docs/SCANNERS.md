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
