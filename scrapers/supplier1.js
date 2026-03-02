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
}

/* =========================
   HELPERS DOM (PAGE/FRAME)
========================= */
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
   LOGIN AUTO-DETECT
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

    return {
      userSel: pick(textCandidates[0] || null),
      passSel: pick(password || null),
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

  await Promise.allSettled([
    submitFormOfInputInContext(page, passSel),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
  ]);

  await humanDelay(1200, 2200);

  const stillPassword = await page.$('input[type="password"]');
  if (stillPassword) {
    await dumpDebug(page, "login_failed");
    throw new Error("Login failed or still on login page");
  }

  // cookies
  const cookies = await page.cookies();
  fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2));
  console.log("Supplier1: login OK");
}

/* =========================
   PLAQUE + MODELE
========================= */
const IMM_SEL = "input[name='immat']";

// Choix modèle “auto” : select ou liste de liens/boutons
async function pickFirstModelIfPresent(page) {
  // petit délai pour laisser l’UI afficher les modèles
  await humanDelay(800, 1600);

  const picked = await page.evaluate(() => {
    // 1) Cas <select>
    const selects = Array.from(document.querySelectorAll("select"))
      .filter((s) => s.options && s.options.length > 1);

    if (selects.length) {
      const sel = selects[0];
      sel.selectedIndex = 1; // 1er choix réel (index 0 souvent placeholder)
      sel.dispatchEvent(new Event("change", { bubbles: true }));

      // cherche un submit dans le même form
      const form = sel.closest("form");
      const btn = form?.querySelector("button[type='submit'], input[type='submit']");
      if (btn) btn.click();

      return { ok: true, mode: "select", label: sel.options[sel.selectedIndex]?.textContent?.trim() || "" };
    }

    // 2) Cas liste de liens/boutons “choisir”
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

    // 3) rien trouvé
    return { ok: false };
  });

  console.log("Supplier1: model pick =", picked);

  if (picked && picked.ok) {
    // navigation éventuelle
    await Promise.race([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
      sleep(1500),
    ]);
    await humanDelay(800, 1600);
    return true;
  }

  // pas de modèle à choisir (soit il n’y en a qu’un, soit autre UI)
  return false;
}

async function enterPlateAndMaybePickModel(page, plate) {
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

  // ✅ essai choix modèle
  await pickFirstModelIfPresent(page);
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

    // après login, on arrive sur un écran de recherche plaque via l’app
    // si tu as une URL menu fixe, mets SUP_URL_MENU ; sinon on reste sur l’état actuel
    if (process.env.SUP_URL_MENU) {
      await gotoStable(page, process.env.SUP_URL_MENU);
    } else {
      await humanDelay();
    }

    await enterPlateAndMaybePickModel(page, plate);
  } catch (e) {
    console.log("Supplier1 ERROR:", String(e?.message || e));
    await dumpDebug(page, "supplier1_error");
    await browser.close();
    throw e;
  }

  const afterUrl = page.url();
  await browser.close();

  // ✅ Validation : plaque OK + modèle peut-être choisi
  return [
    {
      name: "SUP1_MODEL_OK",
      price: 0,
      supplier: "Supplier1",
      url: afterUrl,
    },
  ];
}

module.exports = supplier1Scrape;