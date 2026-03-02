const puppeteer = require("puppeteer");
const fs = require("fs");

const COOKIE_PATH = "/tmp/supplier1-cookies.json";

/* =========================
   UTILITAIRES
========================= */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const humanDelay = async (min = 600, max = 1400) => {
  const t = Math.floor(min + Math.random() * (max - min));
  await sleep(t);
};

const gotoStable = async (page, url) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await humanDelay();
  await sleep(500);
};

// ✅ Clic robuste (dans la page) via JS
async function clickFirstVisible(page, selector) {
  await page.waitForSelector(selector, { timeout: 20000 });

  const ok = await page.evaluate((sel) => {
    const els = Array.from(document.querySelectorAll(sel));
    const el = els.find((e) => {
      const r = e.getBoundingClientRect();
      const s = window.getComputedStyle(e);
      return (
        r.width > 0 &&
        r.height > 0 &&
        s.display !== "none" &&
        s.visibility !== "hidden" &&
        !e.disabled
      );
    });
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  }, selector);

  if (!ok) throw new Error(`No visible clickable element for selector: ${selector}`);
}

// ✅ Cherche un selector sur page ou dans les iframes
async function findSelectorInPageOrFrames(page, selector) {
  // 1) page
  try {
    const h = await page.$(selector);
    if (h) return { where: "page", ctx: page, selector };
  } catch (_) {}

  // 2) frames
  for (const frame of page.frames()) {
    try {
      const h = await frame.$(selector);
      if (h) return { where: `frame:${frame.url()}`, ctx: frame, selector };
    } catch (_) {}
  }

  return null;
}

// ✅ Remplit un input via JS + events, dans page OU frame
async function setInputValueInContext(ctx, selector, value) {
  await ctx.waitForSelector(selector, { timeout: 20000 });

  const ok = await ctx.evaluate(
    ({ sel, val }) => {
      const el = document.querySelector(sel);
      if (!el) return false;

      el.scrollIntoView({ block: "center" });
      el.value = val;

      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));

      return true;
    },
    { sel: selector, val: value }
  );

  if (!ok) throw new Error(`Cannot set value for input: ${selector}`);
}

// ✅ Submit le form qui contient l’input (page OU frame)
async function submitFormOfInputInContext(ctx, inputSelector) {
  await ctx.waitForSelector(inputSelector, { timeout: 20000 });

  const ok = await ctx.evaluate((sel) => {
    const input = document.querySelector(sel);
    if (!input) return false;

    const form = input.closest("form");
    if (!form) return false;

    const btn = form.querySelector("button[type='submit'], input[type='submit']");
    if (btn) {
      btn.scrollIntoView({ block: "center" });
      btn.click();
      return true;
    }

    if (typeof form.submit === "function") {
      form.submit();
      return true;
    }

    return false;
  }, inputSelector);

  if (!ok) throw new Error(`Cannot submit form for input: ${inputSelector}`);
}

/* =========================
   SELECTEURS
========================= */

const SEL = {
  // LOGIN (à adapter si besoin)
  email: "input[name='email'], input[type='email']",
  password: "input[type='password']",
  loginSubmit: "button[type='submit'], input[type='submit']",

  // PLAQUE (confirmé)
  immatInput: "input[name='immat']",
};

/* =========================
   COOKIES
========================= */

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

async function loadCookies(page) {
  if (fs.existsSync(COOKIE_PATH)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH, "utf8"));
    if (Array.isArray(cookies) && cookies.length) {
      await page.setCookie(...cookies);
      return true;
    }
  }
  return false;
}

async function saveCookies(page) {
  const cookies = await page.cookies();
  fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2));
}

/* =========================
   LOGIN
========================= */

async function loginIfNeeded(page) {
  const loginUrl = process.env.SUP_URL_LOGIN;
  const user = process.env.SUP_USER || "";
  const pass = process.env.SUP_PASS || "";

  if (!loginUrl) throw new Error("SUP_URL_LOGIN not defined");
  if (!user) throw new Error("SUP_USER not defined");
  if (!pass) throw new Error("SUP_PASS not defined");

  await gotoStable(page, loginUrl);

  // Si déjà connecté, parfois il n’y a pas de champ password
  const hasPassword = await page.$(SEL.password);
  if (!hasPassword) {
    console.log("Supplier1: already logged-in");
    return;
  }

  console.log("Supplier1: performing login");

  await page.waitForSelector(SEL.email, { timeout: 20000 });
  await humanDelay();

  // Remplir via JS (évite “not clickable”)
  await setInputValueInContext(page, SEL.email, user);
  await humanDelay();

  await setInputValueInContext(page, SEL.password, pass);
  await humanDelay();

  // Click submit (JS) + navigation si elle existe
  await Promise.allSettled([
    clickFirstVisible(page, SEL.loginSubmit),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
  ]);

  await humanDelay(1200, 2200);
  await saveCookies(page);
}

/* =========================
   PLAQUE (immat) + DEBUG
========================= */

async function enterPlate(page, plate) {
  // Aller sur menu si URL fournie
  if (process.env.SUP_URL_MENU) {
    await gotoStable(page, process.env.SUP_URL_MENU);
  } else {
    await humanDelay();
  }

  console.log("Supplier1: current URL before immat =", page.url());

  // Cherche l’input immat sur la page ou dans les frames
  const found = await findSelectorInPageOrFrames(page, SEL.immatInput);

  if (!found) {
    // Debug HTML snippet
    const html = await page.content();
    console.log("Supplier1 DEBUG: immat not found. HTML snippet:\n", html.slice(0, 2500));

    // Debug frames
    const frames = page.frames().map((f) => f.url());
    console.log("Supplier1 DEBUG: frames urls =", frames);

    throw new Error("immat input not found on page (or frames)");
  }

  const ctx = found.ctx;

  console.log("Supplier1: immat found in", found.where);
  await humanDelay();

  // Remplir la plaque (JS)
  await setInputValueInContext(ctx, SEL.immatInput, plate);
  await humanDelay(800, 1600);

  // Submit du form contenant immat (dans le même contexte)
  await Promise.allSettled([
    submitFormOfInputInContext(ctx, SEL.immatInput),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
  ]);

  await humanDelay(1200, 2400);
}

/* =========================
   SCRAPER PRINCIPAL
========================= */

async function supplier1Scrape(plate) {
  plate = (plate || "").toString().trim();
  if (!plate) throw new Error("Missing plate");

  const browser = await launchBrowser();
  const page = await browser.newPage();

  // Anti-ban léger
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
  );
  await page.setViewport({ width: 1366, height: 768 });

  await loadCookies(page);

  // Login
  await loginIfNeeded(page);

  // Plaque
  await enterPlate(page, plate);

  // À ce stade, on valide seulement que la plaque est passée
  const afterUrl = page.url();

  await browser.close();

  return [
    {
      name: "SUP1_PLATE_OK",
      price: 0,
      supplier: "Supplier1",
      url: afterUrl,
    },
  ];
}

module.exports = supplier1Scrape;