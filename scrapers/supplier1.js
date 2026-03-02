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

  console.log("DEBUG url:", url);
  console.log("DEBUG title:", title);
  console.log("DEBUG html snippet:", html.slice(0, 2000));
}

/* =========================
   HELPERS DOM
========================= */
async function setInputValue(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 20000 });
  const ok = await page.evaluate(
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

async function submitFormOfInput(page, inputSelector) {
  await page.waitForSelector(inputSelector, { timeout: 20000 });
  const ok = await page.evaluate((sel) => {
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
   LOGIN AUTO
========================= */
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
      const id = el.getAttribute("id");
      const name = el.getAttribute("name");
      if (id) return `#${CSS.escape(id)}`;
      if (name) return `input[name="${name}"]`;
      return null;
    };

    return { userSel: pick(textCandidates[0] || null), passSel: pick(password || null) };
  });

  if (!result.userSel || !result.passSel) throw new Error("Could not auto-detect login fields");
  return result;
}

async function loginIfNeeded(page) {
  const loginUrl = process.env.SUP_URL_LOGIN;
  const user = process.env.SUP_USER || "";
  const pass = process.env.SUP_PASS || "";

  if (!loginUrl) throw new Error("SUP_URL_LOGIN not defined");
  if (!user) throw new Error("SUP_USER not defined");
  if (!pass) throw new Error("SUP_PASS not defined");

  await gotoStable(page, loginUrl);

  const hasPassword = await page.$('input[type="password"]');
  if (!hasPassword) return;

  const { userSel, passSel } = await findLoginSelectors(page);

  await humanDelay();
  await setInputValue(page, userSel, user);
  await humanDelay();
  await setInputValue(page, passSel, pass);
  await humanDelay();

  await Promise.allSettled([
    submitFormOfInput(page, passSel),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
  ]);

  await humanDelay(1000, 2000);

  const stillPassword = await page.$('input[type="password"]');
  if (stillPassword) {
    await dumpDebug(page, "login_failed");
    throw new Error("Login failed or still on login page");
  }

  const cookies = await page.cookies();
  fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2));
}

/* =========================
   PLAQUE + MODELE
========================= */
const IMM_SEL = "input[name='immat']";

async function pickFirstModelIfPresent(page) {
  await humanDelay(800, 1600);

  const picked = await page.evaluate(() => {
    // select
    const selects = Array.from(document.querySelectorAll("select")).filter((s) => s.options && s.options.length > 1);
    if (selects.length) {
      const sel = selects[0];
      sel.selectedIndex = 1;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      const form = sel.closest("form");
      const btn = form?.querySelector("button[type='submit'], input[type='submit']");
      if (btn) btn.click();
      return { ok: true, mode: "select", label: sel.options[sel.selectedIndex]?.textContent?.trim() || "" };
    }

    // boutons/liens
    const candidates = Array.from(document.querySelectorAll("a,button,input[type='button'],input[type='submit']"));
    const pick = candidates.find((el) => {
      const txt = (el.textContent || "").toLowerCase();
      const v = (el.value || "").toLowerCase();
      return txt.includes("choisir") || txt.includes("sélection") || txt.includes("selection") || v.includes("choisir");
    });
    if (pick) {
      pick.scrollIntoView({ block: "center" });
      pick.click();
      return { ok: true, mode: "button", label: (pick.textContent || pick.value || "").trim() };
    }

    return { ok: false };
  });

  console.log("Supplier1: model pick =", picked);

  if (picked && picked.ok) {
    await Promise.race([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
      sleep(1500),
    ]);
    await humanDelay(800, 1600);
    return true;
  }
  return false;
}

async function enterPlateAndMaybePickModel(page, plate) {
  await page.waitForSelector(IMM_SEL, { timeout: 25000 });

  await humanDelay();
  await setInputValue(page, IMM_SEL, plate);

  await humanDelay(800, 1600);

  await Promise.allSettled([
    submitFormOfInput(page, IMM_SEL),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
  ]);

  await humanDelay(1200, 2400);
  await pickFirstModelIfPresent(page);
}

/* =========================
   EXTRACTION BRUTE (TEST)
========================= */
async function extractPartsRaw(page) {
  await humanDelay(800, 1600);

  // On attend qu'il y ait au moins un tableau OU du contenu significatif
  await Promise.race([
    page.waitForSelector("table", { timeout: 15000 }),
    page.waitForSelector("body", { timeout: 15000 }),
  ]);

  const data = await page.evaluate(() => {
    const clean = (t) => (t || "").replace(/\s+/g, " ").trim();

    // 1) Si une table existe, on prend la première table
    const table = document.querySelector("table");
    if (table) {
      const rows = Array.from(table.querySelectorAll("tr")).slice(0, 30);
      const extracted = rows.map((tr) =>
        Array.from(tr.querySelectorAll("th,td")).map((td) => clean(td.textContent))
      );
      return { mode: "table", extracted };
    }

    // 2) sinon on prend un extrait de texte de la page
    const text = clean(document.body?.innerText || "");
    return { mode: "text", extracted: text.slice(0, 2000) };
  });

  // Convertit en "parts" basiques pour Hostinger (test)
  if (data.mode === "table") {
    const parts = data.extracted
      .map((row) => ({
        name: row.filter(Boolean).slice(0, 5).join(" | "),
        price: 0,
        supplier: "Supplier1",
        url: page.url(),
      }))
      .filter((p) => p.name);

    return parts.slice(0, 20);
  }

  // mode texte
  return [
    {
      name: "RAW_TEXT: " + String(data.extracted).slice(0, 180),
      price: 0,
      supplier: "Supplier1",
      url: page.url(),
    },
  ];
}

/* =========================
   SCRAPER PRINCIPAL
========================= */
async function supplier1Scrape(plate) {
  plate = (plate || "").toString().trim();
  if (!plate) throw new Error("Missing plate");

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
  );
  await page.setViewport({ width: 1366, height: 768 });

  // cookies
  if (fs.existsSync(COOKIE_PATH)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH, "utf8"));
      if (Array.isArray(cookies) && cookies.length) await page.setCookie(...cookies);
    } catch (_) {}
  }

  try {
    await loginIfNeeded(page);

    // Après login, on est dans l'app
    await humanDelay();

    // Plaque + modèle
    await enterPlateAndMaybePickModel(page, plate);

    // ✅ Extraction brute
    const parts = await extractPartsRaw(page);

    await browser.close();
    return parts;
  } catch (e) {
    console.log("Supplier1 ERROR:", String(e?.message || e));
    await dumpDebug(page, "supplier1_error");
    await browser.close();
    throw e;
  }
}

module.exports = supplier1Scrape;