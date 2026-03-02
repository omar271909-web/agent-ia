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

/* =========================
   SELECTEURS
========================= */

const SEL = {
  // LOGIN (adapter si besoin)
  email: "input[name='email'], input[type='email']",
  password: "input[type='password']",
  loginSubmit: "button[type='submit'], input[type='submit']",

  // PLAQUE (confirmé par toi)
  immatInput: "input[name='immat']",
  immatSubmit: "button[type='submit'], input[type='submit']",
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
  if (!process.env.SUP_URL_LOGIN) {
    throw new Error("SUP_URL_LOGIN not defined");
  }

  await gotoStable(page, process.env.SUP_URL_LOGIN);

  const hasPassword = await page.$(SEL.password);
  if (!hasPassword) {
    console.log("Supplier1: already logged-in");
    return;
  }

  console.log("Supplier1: performing login");

  await page.waitForSelector(SEL.email, { timeout: 20000 });
  await humanDelay();

  await page.click(SEL.email, { clickCount: 3 });
  await page.type(SEL.email, process.env.SUP_USER || "", { delay: 25 });

  await humanDelay();

  await page.click(SEL.password, { clickCount: 3 });
  await page.type(SEL.password, process.env.SUP_PASS || "", { delay: 25 });

  await humanDelay();

  await Promise.allSettled([
    page.click(SEL.loginSubmit),
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

  await page.waitForSelector(SEL.immatInput, { timeout: 20000 });

  console.log("Supplier1: entering plate", plate);

  await page.click(SEL.immatInput, { clickCount: 3 });
  await page.type(SEL.immatInput, plate, { delay: 35 });

  await humanDelay(800, 1600);

  await Promise.allSettled([
    page.click(SEL.immatSubmit),
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