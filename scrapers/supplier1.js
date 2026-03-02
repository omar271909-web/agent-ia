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

// ✅ Clique robuste : clique le 1er élément visible correspondant au sélecteur
async function clickFirstVisible(page, selector) {
  await page.waitForSelector(selector, { timeout: 20000 });

  const ok = await page.evaluate((sel) => {
    const els = Array.from(document.querySelectorAll(sel));
    const visible = els.find((el) => {
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const visibleBox = r.width > 0 && r.height > 0;
      const visibleStyle = style.display !== "none" && style.visibility !== "hidden";
      const enabled = !el.disabled;
      return visibleBox && visibleStyle && enabled;
    });

    if (!visible) return false;
    visible.scrollIntoView({ block: "center" });
    visible.click();
    return true;
  }, selector);

  if (!ok) {
    throw new Error(`No visible clickable element for selector: ${selector}`);
  }
}

// ✅ Clique robuste du submit du formulaire qui contient un input donné (ex: immat)
async function clickSubmitOfInputForm(page, inputSelector) {
  await page.waitForSelector(inputSelector, { timeout: 20000 });

  const ok = await page.evaluate((sel) => {
    const input = document.querySelector(sel);
    if (!input) return false;

    const form = input.closest("form");
    if (!form) return false;

    const btn =
      form.querySelector("button[type='submit']") ||
      form.querySelector("input[type='submit']");

    if (!btn) return false;

    btn.scrollIntoView({ block: "center" });
    btn.click();
    return true;
  }, inputSelector);

  if (!ok) {
    throw new Error(`Could not click submit button for form containing: ${inputSelector}`);
  }
}

/* =========================
   SELECTEURS
========================= */

const SEL = {
  // Login (à adapter si ton fournisseur a un autre champ)
  email: "input[name='email'], input[type='email']",
  password: "input[type='password']",
  loginSubmit: "button[type='submit'], input[type='submit']",

  // Plaque (confirmé)
  immatInput: "input[name='immat']",
};

/* =========================
   NAVIGATEUR
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

  // si déjà connecté, parfois il n'y a pas de champ password
  const hasPassword = await page.$(SEL.password);
  if (!hasPassword) {
    console.log("Supplier1: already logged-in");
    return;
  }

  console.log("Supplier1: performing login");

  await page.waitForSelector(SEL.email, { timeout: 20000 });
  await humanDelay();

  await page.click(SEL.email, { clickCount: 3 });
  await page.type(SEL.email, user, { delay: 25 });

  await humanDelay();

  await page.click(SEL.password, { clickCount: 3 });
  await page.type(SEL.password, pass, { delay: 25 });

  await humanDelay();

  await Promise.allSettled([
    clickFirstVisible(page, SEL.loginSubmit),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
  ]);

  await humanDelay(1200, 2200);
  await saveCookies(page);
}

/* =========================
   PLAQUE (immat)
========================= */

async function enterPlate(page, plate) {
  // si tu as une URL menu fixe, mets-la en variable
  if (process.env.SUP_URL_MENU) {
    await gotoStable(page, process.env.SUP_URL_MENU);
  } else {
    await humanDelay();
  }

  await page.waitForSelector(SEL.immatInput, { timeout: 20000 });

  console.log("Supplier1: entering plate", plate);

  await humanDelay();

  await page.click(SEL.immatInput, { clickCount: 3 });
  await page.type(SEL.immatInput, plate, { delay: 35 });

  await humanDelay(800, 1600);

  // ✅ IMPORTANT : on clique le submit du FORMULAIRE qui contient input[name=immat]
  await Promise.allSettled([
    clickSubmitOfInputForm(page, SEL.immatInput),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
  ]);

  // si AJAX
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

  // anti-ban léger
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
  );
  await page.setViewport({ width: 1366, height: 768 });

  await loadCookies(page);
  await loginIfNeeded(page);
  await enterPlate(page, plate);

  const afterUrl = page.url();

  await browser.close();

  // On valide juste “plaque OK” pour l’instant
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