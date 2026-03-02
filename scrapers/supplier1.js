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

async function dumpDebug(page, tag) {
  const safeTag = tag.replace(/[^a-zA-Z0-9_-]/g, "_");
  const ts = Date.now();
  const base = `/tmp/${safeTag}-${ts}`;

  const url = page.url();
  const title = await page.title().catch(() => "");
  const html = await page.content().catch(() => "");

  try {
    await page.screenshot({ path: `${base}.png`, fullPage: true });
    console.log("DEBUG screenshot saved:", `${base}.png`);
  } catch (e) {
    console.log("DEBUG screenshot failed:", String(e?.message || e));
  }

  try {
    fs.writeFileSync(`${base}.html`, html);
    console.log("DEBUG html saved:", `${base}.html`);
  } catch (e) {
    console.log("DEBUG html write failed:", String(e?.message || e));
  }

  const frames = page.frames().map((f) => f.url());

  console.log("DEBUG url:", url);
  console.log("DEBUG title:", title);
  console.log("DEBUG frames:", frames);
  console.log("DEBUG html snippet:", html.slice(0, 2500));

  const lower = html.toLowerCase();
  const hints = [];
  if (lower.includes("cloudflare")) hints.push("cloudflare");
  if (lower.includes("captcha")) hints.push("captcha");
  if (lower.includes("access denied")) hints.push("access_denied");
  if (lower.includes("forbidden")) hints.push("forbidden");
  if (lower.includes("robot")) hints.push("robot_check");
  if (hints.length) console.log("DEBUG hints:", hints.join(", "));
}

/* =========================
   HELPERS DOM (PAGE/FRAME)
========================= */

// Cherche un selector sur page ou frames
async function findSelectorInPageOrFrames(page, selector) {
  try {
    const h = await page.$(selector);
    if (h) return { where: "page", ctx: page, selector };
  } catch (_) {}

  for (const frame of page.frames()) {
    try {
      const h = await frame.$(selector);
      if (h) return { where: `frame:${frame.url()}`, ctx: frame, selector };
    } catch (_) {}
  }
  return null;
}

// Remplit un input via JS + events (page OU frame)
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

// Soumet le form qui contient l’input (page OU frame)
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
   LOGIN AUTO-DETECT
========================= */

// Trouve automatiquement les champs login/password visibles sur la page
async function findLoginSelectors(page) {
  const result = await page.evaluate(() => {
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden" && !el.disabled;
    };

    const inputs = Array.from(document.querySelectorAll("input")).filter(isVisible);

    const password = inputs.find((i) => (i.getAttribute("type") || "").toLowerCase() === "password");
    const textCandidates = inputs.filter((i) => {
      const type = (i.getAttribute("type") || "text").toLowerCase();
      return type === "text" || type === "email" || type === "tel";
    });

    const pick = (el) => {
      if (!el) return null;
      // fabrique un selector robuste
      const id = el.getAttribute("id");
      const name = el.getAttribute("name");
      if (id) return `#${CSS.escape(id)}`;
      if (name) return `input[name="${name}"]`;
      return null;
    };

    return {
      userSel: pick(textCandidates[0] || null),
      passSel: pick(password || null),
      // infos debug utiles
      allInputNames: inputs.map((i) => ({
        type: i.getAttribute("type") || "",
        name: i.getAttribute("name") || "",
        id: i.getAttribute("id") || "",
        placeholder: i.getAttribute("placeholder") || "",
      })),
    };
  });

  console.log("Supplier1 DEBUG: visible inputs =", result.allInputNames);

  if (!result.userSel || !result.passSel) {
    throw new Error("Could not auto-detect login fields (user/password)");
  }

  return { userSel: result.userSel, passSel: result.passSel };
}

async function loginIfNeeded(page) {
  const loginUrl = process.env.SUP_URL_LOGIN;
  const user = process.env.SUP_USER || "";
  const pass = process.env.SUP_PASS || "";

  if (!loginUrl) throw new Error("SUP_URL_LOGIN not defined");
  if (!user) throw new Error("SUP_USER not defined");
  if (!pass) throw new Error("SUP_PASS not defined");

  await gotoStable(page, loginUrl);

  // Si déjà connecté, il est possible qu'il n'y ait aucun password visible
  const hasPassword = await page.$('input[type="password"]');
  if (!hasPassword) {
    console.log("Supplier1: already logged-in (no password field)");
    return;
  }

  console.log("Supplier1: performing login (auto-detect)");

  const { userSel, passSel } = await findLoginSelectors(page);

  await humanDelay();
  await setInputValueInContext(page, userSel, user);

  await humanDelay();
  await setInputValueInContext(page, passSel, pass);

  await humanDelay();

  // Soumet le formulaire du password (le plus fiable)
  await Promise.allSettled([
    submitFormOfInputInContext(page, passSel),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
  ]);

  await humanDelay(1200, 2200);

  // Si on voit encore un password, login probablement échoué
  const stillPassword = await page.$('input[type="password"]');
  if (stillPassword) {
    console.log("Supplier1: login might have failed (still on login page)");
    await dumpDebug(page, "login_failed");
    throw new Error("Login failed or still on login page");
  }

  await saveCookies(page);
  console.log("Supplier1: login OK");
}

/* =========================
   PLAQUE (immat)
========================= */
const IMM_SEL = "input[name='immat']";

async function enterPlate(page, plate) {
  // Après login, si tu as une URL menu fixe, mets SUP_URL_MENU.
  if (process.env.SUP_URL_MENU) {
    await gotoStable(page, process.env.SUP_URL_MENU);
  } else {
    await humanDelay();
  }

  console.log("Supplier1: URL before immat:", page.url());

  const found = await findSelectorInPageOrFrames(page, IMM_SEL);
  if (!found) {
    await dumpDebug(page, "immat_not_found");
    throw new Error("immat input not found on page (or frames)");
  }

  const ctx = found.ctx;
  console.log("Supplier1: immat found in", found.where);

  await humanDelay();
  await setInputValueInContext(ctx, IMM_SEL, plate);

  await humanDelay(800, 1600);

  await Promise.allSettled([
    submitFormOfInputInContext(ctx, IMM_SEL),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
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

  try {
    await loginIfNeeded(page);
    await enterPlate(page, plate);
  } catch (e) {
    console.log("Supplier1 ERROR:", String(e?.message || e));
    await dumpDebug(page, "supplier1_error");
    await browser.close();
    throw e;
  }

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