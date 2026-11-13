# Incident Response Plan — Alfixed Inc (XFITTING)

Covers the XFitting tools app (xf-tools: the pages, the `xfitting-lookup` and `xfitting-profit`
Cloudflare Workers, the D1 database) and every account that can reach **Amazon Information**
(data we get from Amazon's Selling Partner API: orders, listings, prices, fees, inventory, reports).

- Adopted: 2026-11-13 by the Owner
- Next review: **2027-05-13** (every 6 months — see the review log at the end)

## 1. Who does what (defined roles)

| Role | Who | What they do |
|---|---|---|
| **Incident lead** | The Owner (primary Amazon Seller Central account) | Decides, contains, notifies Amazon, signs off the record |
| **Backup lead** | An Admin named by the Owner: ____________________ | Takes over if the Owner can't be reached within 2 hours |
| **Everyone who uses the app** | All staff | Report anything strange to the Owner **right away** (a strange sign-in, a lost phone / scanner, a password seen by someone else, a message asking for a password or key) |

## 2. What counts as an incident

- An Amazon API key (Client ID / Client Secret / Refresh token) or a Cloudflare / GitHub login seen by
  someone who should not have it, posted anywhere, or lost.
- Someone signed in to the app, Seller Central, Cloudflare or GitHub who should not have.
- A lost or stolen phone, scanner or computer that was signed in to the app.
- A virus / malware on a computer used for the app or Seller Central.
- Amazon Information sent, shown or stored anywhere it should not be.

## 3. What to do (first 24 hours)

1. **Report** — anyone who sees it tells the Owner (or the Backup lead) at once. Write down the time it
   was found.
2. **Contain** (as fast as possible, same day):
   - Amazon: Solution Provider Portal → our app → **rotate the Client Secret**; if the Refresh token may
     be out, **remove the app's authorization** in Seller Central → Apps and Services → Manage Your Apps,
     then authorize it again (new Refresh token).
   - Put the new values in Cloudflare → `xfitting-lookup` and `xfitting-profit` → Settings → Variables
     and Secrets (`AMAZON_CLIENT_SECRET`, `AMAZON_REFRESH_TOKEN`). Never in chat, email or the code.
   - App: Admin → users → **reset the password** of any account involved (this signs that person out
     everywhere); deactivate an account that should not exist.
   - Change the Seller Central / Cloudflare / GitHub password of any account involved; make sure MFA is on.
   - A lost device: reset that person's app password (signs the device out).
3. **Check what happened** — the app keeps records: Admin sign-in log (who signed in, when, from where),
   History / activity logs, Cloudflare and GitHub audit logs. Write down what data may have been seen.
4. **Notify Amazon within 24 hours of finding it** — email **security@amazon.com** (and follow any
   instructions from Amazon). Include: what happened, when it was found, what Amazon Information may be
   involved, what was done to stop it, and a contact (Owner name, phone, email).
5. **Notify others if needed** — anyone whose information was involved, as the law requires.

## 4. After the incident

- Write a short record: date / time found, who found it, what happened, what was done, when Amazon was
  told, what will change so it does not happen again. Keep it with this plan.
- Make the change (for example: a new rule, fewer people with access, a new password).

## 5. Keeping the plan current (every 6 months)

- The Owner reviews this plan every 6 months (and after any incident): the names in section 1, the steps
  in section 3, and who has access to the app, Seller Central, Cloudflare and GitHub (remove anyone who
  left).
- Rotate the Amazon Client Secret before Amazon's expiry (about every 180 days; Amazon emails before).

### Review log

| Date | Reviewed by | Changes |
|---|---|---|
| 2026-11-13 | Owner | Plan adopted |
| | | |
