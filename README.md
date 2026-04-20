# Simply Smashing Booking Tracker

Automated daily scraper that monitors booking availability on [simplysmashing.com](https://simplysmashing.com) for the period **April 20 – May 9, 2025**, running every morning at **7:00 AM Pacific Time** via GitHub Actions.

---

## What it does

- Opens the Simply Smashing website in a headless browser (Playwright + Chromium)
- Clicks **Book Now**, toggles to **Browse Activities** mode
- Extracts availability data for each date in the monitoring window
- Saves a Markdown report and raw JSON to the `reports/` folder
- Commits the report back to this repository automatically
- Emails you the report (optional — requires Gmail setup)
- Detects changes from the previous day's report

---

## Setup (one-time, ~10 minutes)

### 1. Fork or create this repository on GitHub

Go to [github.com](https://github.com), create a new **private** repository, and push this folder to it:

```bash
cd simply-smashing-tracker
git init
git add .
git commit -m "Initial setup"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

### 2. Create the `reports/` folder in git

GitHub Actions needs this folder to exist:

```bash
mkdir -p reports
touch reports/.gitkeep
git add reports/.gitkeep
git commit -m "Add reports folder"
git push
```

### 3. Set up email notifications (optional but recommended)

The workflow emails you the daily report. It uses Gmail with an App Password.

**Step A — Create a Gmail App Password:**
1. Go to your Google Account → Security → 2-Step Verification (must be enabled)
2. Scroll to **App passwords** → Generate one → name it "GitHub Tracker"
3. Copy the 16-character password

**Step B — Add GitHub Secrets:**
Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add these three secrets:

| Secret name | Value |
|---|---|
| `GMAIL_USERNAME` | your Gmail address (e.g. `you@gmail.com`) |
| `GMAIL_APP_PASSWORD` | the 16-char app password from Step A |
| `NOTIFY_EMAIL` | email address to receive reports (can be same as above) |

### 4. Enable GitHub Actions

Go to your repo → **Actions** tab → click **"I understand my workflows, go ahead and enable them"** if prompted.

### 5. Test it manually

Go to **Actions** → **Simply Smashing Daily Booking Report** → **Run workflow** → **Run workflow**

Watch it run live. Check the `reports/` folder for the output.

---

## Viewing reports

Daily reports are stored in `reports/report_YYYY-MM-DD.md` and committed automatically. You can view them directly on GitHub by browsing to the `reports/` folder in your repository.

Each report shows:
- Availability status per date (🟢 Available / 🔴 Sold out / ⚫ No data)
- Changes detected since the previous day
- Errors if the scraper encountered issues

---

## Troubleshooting

**"No slot data captured" in the report**
FareHarbor's widget may load inside a cross-origin iframe that Playwright can't fully access. A screenshot is saved each run in `reports/` (visible as a GitHub Actions artifact). Check the screenshot to see what the scraper actually rendered.

**Email not sending**
Double-check your three secrets are set correctly. Gmail App Passwords are different from your regular password — make sure you generated one specifically.

**Workflow not running at 7 AM**
GitHub Actions schedules run on UTC time and may be delayed by up to 15 minutes during high-traffic periods. 7 AM Pacific = 2 PM UTC (PDT) / 3 PM UTC (PST).

---

## File structure

```
simply-smashing-tracker/
├── .github/
│   └── workflows/
│       └── daily-report.yml   ← the automation schedule
├── scripts/
│   └── scrape.js              ← the scraper logic
├── reports/                   ← auto-populated daily
│   ├── report_2025-04-20.md
│   ├── data_2025-04-20.json
│   └── ...
├── package.json
└── README.md
```
