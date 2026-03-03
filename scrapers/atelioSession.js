const puppeteer = require("puppeteer");

const sessions = new Map();

function makeId() {
  return "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function newBrowserPage() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
  );
  await page.setViewport({ width: 1366, height: 768 });

  return { browser, page };
}

async function createSession() {
  const sessionId = makeId();
  const { browser, page } = await newBrowserPage();
  sessions.set(sessionId, { browser, page, lastUsed: Date.now() });
  return sessionId;
}

function getSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) throw new Error("Invalid sessionId (expired or unknown). Restart from step 1.");
  s.lastUsed = Date.now();
  return s;
}

async function closeSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;
  sessions.delete(sessionId);
  await s.page.close().catch(() => {});
  await s.browser.close().catch(() => {});
}

setInterval(async () => {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (now - s.lastUsed > 8 * 60 * 1000) {
      await closeSession(id);
    }
  }
}, 60 * 1000);

module.exports = { createSession, getSession, closeSession };