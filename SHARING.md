# Sharing Denial Worklist with your team

Pick **one** of these. Option A is easiest for most teams.

---

## Option A: A shared web link (GitHub Pages)

Your team opens one link in Chrome or Edge. Files they drop in are still read only on their own computer; the link just delivers the page.

**One-time setup (the repository owner):**

1. Open the repository on github.com.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose branch **main** and folder **/ (root)**, then **Save**.
4. Wait 1–2 minutes. GitHub shows the link, like `https://yourname.github.io/denial-agent/`.
5. Send that link to your team. They bookmark it.

**Good to know**

- On a free GitHub account, Pages only works for **public** repositories. For a private repository you need a paid plan (GitHub Pro or Team).
- The page itself contains no patient data, only code. Even if the page is public, nobody can see your files: they never leave each person's computer.
- When you change anything in the repository (for example `js/codes.js`), the link updates automatically within a few minutes.

---

## Option B: Download and open (no internet needed)

1. On the repository page, click **Code → Download ZIP**.
2. Unzip it into a shared folder or each person's computer.
3. Double-click `index.html`. It opens in the browser.

When you update the tool, everyone downloads the ZIP again.

---

## Option C: Team members with GitHub accounts

For people who will edit the tool (for example, update the denial code guide):

1. Repository → **Settings → Collaborators** → **Add people**. Give **Write** access to editors, **Read** to everyone else.
2. Editors change files on github.com (open a file, click the pencil icon, **Commit changes**) or with GitHub Desktop.
3. With Option A on, every change goes live on the shared link.

---

## Rules for the team

- **Never upload real ERA, EFT or Excel output files to GitHub.** Patient data stays on work computers only.
- Tick **Hide patient names** before sharing your screen or emailing the Excel file outside the billing team.
- Use work computers with screen lock and disk encryption.
- If a code is sorted wrong, tell the person who maintains `js/codes.js`; don't work around it.

## Daily routine (suggested)

1. Morning: download yesterday's ERA files and the bank deposit list.
2. Open Denial Worklist, drop in both.
3. Check **Payments** first: any missing deposits or mismatches go to the posting lead.
4. **Download Excel**, assign rows by practice or action, and work the list biggest dollars first.
5. End of day: fill in the Notes column and save the Excel file in your team's shared drive.
