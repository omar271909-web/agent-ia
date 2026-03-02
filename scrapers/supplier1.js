const puppeteer = require("puppeteer");
const fs = require("fs");

const COOKIE_PATH = "/tmp/supplier1-cookies.json";

// Anti-ban léger : pauses “humaines”
const humanDelay = async (page, minMs = 600, maxMs = 1400) => {
  const t = Math.floor(minMs + Math.random() * (maxMs - minMs));
  await page.waitForTimeout(t);
};

// Anti-ban léger : navigation + wait stable
const gotoStable = async (page, url) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await humanDelay(page);
  // parfois le réseau continue, on donne un peu de marge
  await page.waitForTimeout(500);
};

const SEL = {
  // Login (souvent OK)
  email: "input[name='email'], input[type='email']",
  password: "input[type='password']",
  loginSubmit: "button[type='submit'], input[type='submit']",

  // Main menu - plaque
  immatInput: "input[name='immat']",
  immatSubmit: "button[type='submit'], input[type='submit']",
};

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

async function loginIfNeeded(page) {
  await gotoStable(page, process.env.SUP_URL_LOGIN);

  // Si déjà connecté, pas de champ password
  const hasPassword = await page.$(SEL.password);
  if (!hasPassword) {
    console.log("Supplier1: already logged-in");
    return;
  }

  await page.waitForSelector(SEL.email, { timeout: 20000 });
  await humanDelay(page);

  await page.click(SEL.email, { clickCount: 3 });
  await page.type(SEL.email, process.env.SUP_USER, { delay: 25 });

  await humanDelay(page);

  await page.click(SEL.password, { clickCount: 3 });
  await page.type(SEL.password, process.env.SUP_PASS, { delay: 25 });

  await humanDelay(page);

  // submit + attendre navigation si elle existe
  await Promise.allSettled([
    page.click(SEL.loginSubmit),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
  ]);

  await humanDelay(page, 1200, 2200);
  await saveCookies(page);
}

async function enterPlate(page, plate) {
  // Si menu URL connu, on s’y rend
  if (process.env.SUP_URL_MENU) {
    await gotoStable(page, process.env.SUP_URL_MENU);
  } else {
    // sinon on suppose qu'on est déjà au bon endroit
    await humanDelay(page);
  }

  await page.waitForSelector(SEL.immatInput, { timeout: 20000 });
  await humanDelay(page);

  // taper la plaque "humainement"
  await page.click(SEL.immatInput, { clickCount: 3 });
  await page.type(SEL.immatInput, plate, { delay: 35 });

  await humanDelay(page, 800, 1600);

  await Promise.allSettled([
    page.click(SEL.immatSubmit),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
  ]);

  // si la page charge en AJAX, on laisse respirer
  await humanDelay(page, 1200, 2400);
}

async function supplier1Scrape(plate) {
  plate = (plate || "").toString().trim();
  if (!plate) throw new Error("Missing plate");

  const browser = await launchBrowser();
  const page = await browser.newPage();

  // Anti-ban léger : user-agent “normal”
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
  );

  // Anti-ban léger : viewport standard
  await page.setViewport({ width: 1366, height: 768 });

  // Cookies session
  await loadCookies(page);

  // Login si nécessaire
  await loginIfNeeded(page);

  // Entrer plaque
  await enterPlate(page, plate);

  // Pour test : on confirme qu'on est passé après la plaque
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