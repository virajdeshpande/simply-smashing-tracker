const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

// Date range to monitor
const START_DATE = new Date("2025-04-20");
const END_DATE = new Date("2025-05-09");

function formatDate(date) {
  return date.toISOString().split("T")[0];
}

function parseDateFromLabel(label) {
  // FareHarbor typically shows dates as "April 20" or "Apr 20, 2025" etc.
  try {
    const parsed = new Date(label);
    if (!isNaN(parsed)) return formatDate(parsed);
  } catch {}
  return null;
}

function isInRange(dateStr) {
  const d = new Date(dateStr);
  return d >= START_DATE && d <= END_DATE;
}

async function scrape() {
  console.log(`[${new Date().toISOString()}] Starting scrape...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  const results = {
    scrapeDate: formatDate(new Date()),
    scrapeTime: new Date().toISOString(),
    activities: [],
    rawSlots: [],
    errors: [],
  };

  try {
    // Step 1: Load homepage
    console.log("Loading homepage...");
    await page.goto("https://simplysmashing.com/", {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Step 2: Click "Book Now" button
    console.log("Clicking Book Now...");
    const bookNowBtn = await page.locator('text=Book Now').first();
    await bookNowBtn.waitFor({ timeout: 10000 });
    await bookNowBtn.click();
    await page.waitForTimeout(2000);

    // Step 3: Check if we need to toggle to "Browse Activities"
    // Look for the icon-search anchor tag which toggles between modes
    console.log("Checking booking widget mode...");
    await page.waitForTimeout(1500);

    // Try to find and click icon-search if it exists (switches to Browse Activities)
    const iconSearch = await page.locator('#icon-search').first();
    const iconSearchVisible = await iconSearch.isVisible().catch(() => false);

    if (iconSearchVisible) {
      console.log("Toggling to Browse Activities via #icon-search...");
      await iconSearch.click();
      await page.waitForTimeout(2000);
    } else {
      console.log("#icon-search not found or already in Browse Activities mode");
    }

    // Step 4: Wait for activity listings to load
    console.log("Waiting for activities to load...");
    await page.waitForTimeout(3000);

    // Step 5: Capture a screenshot for debugging
    const screenshotPath = path.join(
      __dirname,
      `../reports/screenshot_${formatDate(new Date())}.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`Screenshot saved: ${screenshotPath}`);

    // Step 6: Extract all activity names and their available time slots
    // FareHarbor renders activities as cards/items with availability calendars
    const activities = await page.evaluate(() => {
      const activityData = [];

      // FareHarbor activity items — try multiple selector patterns
      const activitySelectors = [
        '.fh-activity',
        '.activity-item',
        '[data-activity]',
        '.FH-AvailabilityCalendar',
        '.fh-cal',
        '[class*="activity"]',
        '[class*="Activity"]',
      ];

      let activityNodes = [];
      for (const sel of activitySelectors) {
        const nodes = document.querySelectorAll(sel);
        if (nodes.length > 0) {
          activityNodes = Array.from(nodes);
          break;
        }
      }

      activityNodes.forEach((node) => {
        const nameEl = node.querySelector('h2, h3, h4, [class*="title"], [class*="name"]');
        const name = nameEl ? nameEl.innerText.trim() : "Unknown Activity";
        activityData.push({ name, html: node.innerHTML.substring(0, 500) });
      });

      return activityData;
    });

    results.activities = activities;
    console.log(`Found ${activities.length} activity nodes`);

    // Step 7: Extract calendar/slot data — FareHarbor date cells
    const slots = await page.evaluate((startStr, endStr) => {
      const start = new Date(startStr);
      const end = new Date(endStr);
      const slotData = [];

      // FareHarbor renders calendar date cells with availability classes
      // Common patterns: .fh-cal-day, [data-date], td[data-id], etc.
      const dateSelectors = [
        'td[data-date]',
        '[data-date]',
        '.fh-cal-day',
        '[class*="cal-day"]',
        '[class*="CalDay"]',
        'td[class*="day"]',
      ];

      let dateCells = [];
      for (const sel of dateSelectors) {
        const cells = document.querySelectorAll(sel);
        if (cells.length > 0) {
          dateCells = Array.from(cells);
          break;
        }
      }

      dateCells.forEach((cell) => {
        const dateAttr =
          cell.getAttribute("data-date") ||
          cell.getAttribute("data-id") ||
          cell.getAttribute("data-day");

        if (!dateAttr) return;

        const cellDate = new Date(dateAttr);
        if (isNaN(cellDate) || cellDate < start || cellDate > end) return;

        const dateStr = cellDate.toISOString().split("T")[0];
        const classList = Array.from(cell.classList);
        const text = cell.innerText.trim();

        // Determine availability status from classes
        const isAvailable =
          classList.some((c) =>
            ["available", "has-availability", "open", "fh-available"].some((k) =>
              c.toLowerCase().includes(k)
            )
          ) ||
          (text !== "" &&
            !classList.some((c) =>
              ["unavailable", "closed", "past", "disabled", "sold-out"].some((k) =>
                c.toLowerCase().includes(k)
              )
            ));

        const isSoldOut = classList.some((c) =>
          ["sold-out", "soldout", "full", "unavailable"].some((k) =>
            c.toLowerCase().includes(k)
          )
        );

        slotData.push({
          date: dateStr,
          classes: classList.join(" "),
          text,
          isAvailable,
          isSoldOut,
        });
      });

      return slotData;
    }, formatDate(START_DATE), formatDate(END_DATE));

    results.rawSlots = slots;
    console.log(`Found ${slots.length} date slots in range`);

    // Step 8: If FareHarbor didn't expose data-date attrs, try iframe approach
    if (slots.length === 0) {
      console.log("No slots via DOM — checking for iframes...");
      const frames = page.frames();
      console.log(`Found ${frames.length} frames`);

      for (const frame of frames) {
        const frameUrl = frame.url();
        if (frameUrl.includes("fareharbor") || frameUrl.includes("simplysmashing")) {
          console.log(`Checking frame: ${frameUrl}`);
          const frameSlots = await frame.evaluate((startStr, endStr) => {
            const start = new Date(startStr);
            const end = new Date(endStr);
            const slotData = [];
            const cells = document.querySelectorAll('[data-date], td[data-date], .fh-cal-day');
            cells.forEach((cell) => {
              const dateAttr = cell.getAttribute("data-date");
              if (!dateAttr) return;
              const cellDate = new Date(dateAttr);
              if (isNaN(cellDate) || cellDate < start || cellDate > end) return;
              slotData.push({
                date: cellDate.toISOString().split("T")[0],
                classes: Array.from(cell.classList).join(" "),
                text: cell.innerText?.trim() || "",
              });
            });
            return slotData;
          }, formatDate(START_DATE), formatDate(END_DATE)).catch(() => []);

          if (frameSlots.length > 0) {
            results.rawSlots = frameSlots;
            console.log(`Found ${frameSlots.length} slots in iframe`);
            break;
          }
        }
      }
    }

  } catch (err) {
    console.error("Scrape error:", err.message);
    results.errors.push(err.message);
  } finally {
    await browser.close();
  }

  return results;
}

function buildDailyReport(results) {
  const today = results.scrapeDate;
  const lines = [];

  lines.push(`# Simply Smashing Booking Report`);
  lines.push(`**Scrape date:** ${today} at ${results.scrapeTime}`);
  lines.push(`**Monitoring window:** April 20 – May 9, 2025`);
  lines.push("");

  if (results.errors.length > 0) {
    lines.push(`## ⚠️ Errors`);
    results.errors.forEach((e) => lines.push(`- ${e}`));
    lines.push("");
  }

  if (results.rawSlots.length === 0) {
    lines.push(`## No slot data captured`);
    lines.push(
      `The scraper loaded the page but could not extract structured date/availability data.`
    );
    lines.push(`This can happen if:`);
    lines.push(`- The booking widget uses an iframe with cross-origin restrictions`);
    lines.push(`- FareHarbor requires user interaction before rendering calendars`);
    lines.push(`- The CSS class names have changed`);
    lines.push("");
    lines.push(`A screenshot has been saved to reports/ for manual inspection.`);
    lines.push("");
    lines.push(`**Activities detected on page:** ${results.activities.length}`);
    results.activities.forEach((a) => lines.push(`- ${a.name}`));
  } else {
    lines.push(`## Availability by Date`);
    lines.push("");
    lines.push(`| Date | Day | Status | Notes |`);
    lines.push(`|------|-----|--------|-------|`);

    // Generate all dates in range
    const cur = new Date(START_DATE);
    while (cur <= END_DATE) {
      const dateStr = formatDate(cur);
      const dayName = cur.toLocaleDateString("en-US", { weekday: "short" });
      const slot = results.rawSlots.find((s) => s.date === dateStr);

      let status = "—";
      let notes = "";
      if (slot) {
        if (slot.isSoldOut) {
          status = "🔴 Sold out";
        } else if (slot.isAvailable) {
          status = "🟢 Available";
        } else {
          status = "⚪ Unknown";
          notes = slot.classes.substring(0, 60);
        }
      } else {
        status = "⚫ No data";
      }

      lines.push(`| ${dateStr} | ${dayName} | ${status} | ${notes} |`);
      cur.setDate(cur.getDate() + 1);
    }

    lines.push("");
    const available = results.rawSlots.filter((s) => s.isAvailable).length;
    const soldOut = results.rawSlots.filter((s) => s.isSoldOut).length;
    lines.push(`**Summary:** ${available} days available, ${soldOut} days sold out, ${results.rawSlots.length} total days with data`);
  }

  return lines.join("\n");
}

async function loadPreviousReport() {
  const reportsDir = path.join(__dirname, "../reports");
  try {
    const files = fs
      .readdirSync(reportsDir)
      .filter((f) => f.startsWith("data_") && f.endsWith(".json"))
      .sort()
      .reverse();

    if (files.length > 0) {
      const latest = JSON.parse(
        fs.readFileSync(path.join(reportsDir, files[0]), "utf8")
      );
      return latest;
    }
  } catch {}
  return null;
}

function diffReports(prev, curr) {
  if (!prev || !curr) return null;
  const changes = [];

  const prevSlots = new Map(prev.rawSlots.map((s) => [s.date, s]));
  const currSlots = new Map(curr.rawSlots.map((s) => [s.date, s]));

  for (const [date, currSlot] of currSlots) {
    const prevSlot = prevSlots.get(date);
    if (!prevSlot) continue;
    if (prevSlot.isAvailable && currSlot.isSoldOut) {
      changes.push(`${date}: became SOLD OUT (was available)`);
    } else if (prevSlot.isSoldOut && currSlot.isAvailable) {
      changes.push(`${date}: back to AVAILABLE (was sold out)`);
    }
  }

  return changes;
}

async function main() {
  const reportsDir = path.join(__dirname, "../reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const prev = await loadPreviousReport();
  const results = await scrape();

  // Save raw JSON
  const jsonPath = path.join(reportsDir, `data_${results.scrapeDate}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`Data saved: ${jsonPath}`);

  // Compute diff
  const changes = diffReports(prev, results);
  if (changes && changes.length > 0) {
    results.changesFromPrevious = changes;
    console.log("\n=== CHANGES FROM PREVIOUS REPORT ===");
    changes.forEach((c) => console.log(c));
  } else {
    results.changesFromPrevious = [];
    console.log("No availability changes since last report.");
  }

  // Build markdown report
  const report = buildDailyReport(results);
  const mdPath = path.join(reportsDir, `report_${results.scrapeDate}.md`);
  fs.writeFileSync(mdPath, report);
  console.log(`Report saved: ${mdPath}`);

  // Print summary to stdout (visible in GitHub Actions log)
  console.log("\n========== DAILY REPORT ==========");
  console.log(report);
  console.log("===================================");

  // Exit with error code if scrape had errors (for GH Actions notification)
  if (results.errors.length > 0 && results.rawSlots.length === 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
