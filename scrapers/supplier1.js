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

// ✅ Clic robuste (JS) : aucun .click Puppeteer
async function clickFirstVisible(page, selector) {
  await page.waitForSelector(selector, { timeout: 20000 });

  const ok = await page.evaluate((sel) => {
    const els = Array.from(document.querySelectorAll(sel));
    const el = els.find((e) => {
      const r = e.getBoundingClientRect();
      const s = window.getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden" && !e.disabled;
    });
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  }, selector);

  if (!ok) throw new Error(`No visible clickable element for selector: ${selector}`);
}

// ✅ Remplissage robuste : set value + events (aucun click)
async function setInputValue(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 20000 });

  const ok = await page.evaluate(
    ({ sel, val }) => {
      const el = document.querySelector(sel);
      if (!el) return false;

      el.scrollIntoView({ block: "center" });

      // Pour inputs classiques
      el.value = val;

      // Déclenche les events comme un vrai utilisateur
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    { sel: selector, val: value }
  );

  if (!ok) throw new Error(`Cannot set value for input: ${selector}`);
}

// ✅ Clique le submit du FORM qui contient l’input (immat)
async function submitFormOfInput(page, inputSelector) {
  await page.waitForSelector(inputSelector, { timeout: 20000 });

  const ok = await page.evaluate((sel) => {
    const input = document.querySelector(sel);
    if (!input) return false;

    const form = input.closest("form");
    if (!form) return false;

    // 1) bouton submit si présent
    const btn = form.querySelector("button[type='submit'], input[type='submit']");
    if (btn) {
      btn.scrollIntoView({ block: "center" });
      btn.click();
      return true;
    }

    // 2) sinon submit() JS
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
  // Login (à adapter si besoin)
  email: "input[name='email'], input[type='email']",
  password: "input[type='password']",
  loginSubmit: "button[type='submit'], input[type='submit']",

  // Plaque (confirmé)
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

  // Si déjà connecté, parfois pas de champ password
  const hasPassword = await page.$(SEL.password);
  if (!hasPassword) {
    console.log("Supplier1: already logged-in");
    return;
  }

  console.log("Supplier1: performing login");

  await humanDelay();
  await setInputValue(page, SEL.email, user);

  await humanDelay();
  await setInputValue(page, SEL.password, pass);

  await humanDelay();

  await Promise.allSettled([
    clickFirstVisible(page, SEL.loginSubmit),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
  ]);

  await humanDelay(1200, 2200);
  await saveCookies(page);
}

/* =========================
   PLAQUE
========================= */

async function enterPlate(page, plate) {
  if (process.env.SUP_URL_MENU) {
    await gotoStable(page, process.env.SUP_URL_MENU);
  } else {
    await humanDelay();
  }

  console.log("Supplier1: entering plate", plate);

  await humanDelay();
  await setInputValue(page, SEL.immatInput, plate);

  await humanDelay(800, 1600);

  await Promise.allSettled([
    submitFormOfInput(page, SEL.immatInput),
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

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
  );
  await page.setViewport({ width: 1366, height: 768 });

  await loadCookies(page);
  await loginIfNeeded(page);
  await enterPlate(page, plate);

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