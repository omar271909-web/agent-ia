const puppeteer = require("puppeteer");
const fs = require("fs");

const COOKIE_PATH = "/tmp/atelio-cookies.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const humanDelay = async (min = 500, max = 1200) => {
  const t = Math.floor(min + Math.random() * (max - min));
  await sleep(t);
};

async function gotoStable(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await humanDelay();
  await sleep(300);
}

async function loadCookies(page) {
  if (fs.existsSync(COOKIE_PATH)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH, "utf8"));
      if (Array.isArray(cookies) && cookies.length) await page.setCookie(...cookies);
    } catch (_) {}
  }
}

async function saveCookies(page) {
  const cookies = await page.cookies();
  fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2));
}

async function dumpDebug(page, tag) {
  const ts = Date.now();
  const base = `/tmp/${tag}-${ts}`;
  try {
    await page.screenshot({ path: `${base}.png`, fullPage: true });
    console.log("DEBUG screenshot:", `${base}.png`);
  } catch (_) {}
  try {
    const html = await page.content();
    fs.writeFileSync(`${base}.html`, html);
    console.log("DEBUG html:", `${base}.html`);
    console.log("DEBUG url:", page.url());
    console.log("DEBUG title:", await page.title().catch(() => ""));
    console.log("DEBUG html snippet:", html.slice(0, 2000));
  } catch (_) {}
}

/**
 * Login auto: on prend 1 input texte visible + 1 password visible et on submit le form du password
 */
async function loginIfNeeded(page) {
  const loginUrl = process.env.SUP_URL_LOGIN;
  const user = process.env.SUP_USER || "";
  const pass = process.env.SUP_PASS || "";
  if (!loginUrl) throw new Error("SUP_URL_LOGIN not defined");
  if (!user) throw new Error("SUP_USER not defined");
  if (!pass) throw new Error("SUP_PASS not defined");

  await gotoStable(page, loginUrl);

  const hasPassword = await page.$('input[type="password"]');
  if (!hasPassword) return; // déjà loggé

  const sels = await page.evaluate(() => {
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden" && !el.disabled;
    };
    const inputs = Array.from(document.querySelectorAll("input")).filter(isVisible);
    const passEl = inputs.find((i) => (i.getAttribute("type") || "").toLowerCase() === "password");
    const userEl = inputs.find((i) => {
      const t = (i.getAttribute("type") || "text").toLowerCase();
      return t === "text" || t === "email" || t === "tel";
    });

    const pick = (el) => {
      if (!el) return null;
      const id = el.getAttribute("id");
      const name = el.getAttribute("name");
      if (id) return `#${CSS.escape(id)}`;
      if (name) return `input[name="${name}"]`;
      return null;
    };

    return { userSel: pick(userEl), passSel: pick(passEl) };
  });

  if (!sels.userSel || !sels.passSel) {
    await dumpDebug(page, "login_fields_not_found");
    throw new Error("Could not auto-detect login fields");
  }

  // set value via JS
  await page.evaluate(
    ({ userSel, passSel, user, pass }) => {
      const u = document.querySelector(userSel);
      const p = document.querySelector(passSel);
      if (!u || !p) return;
      u.value = user;
      u.dispatchEvent(new Event("input", { bubbles: true }));
      u.dispatchEvent(new Event("change", { bubbles: true }));
      p.value = pass;
      p.dispatchEvent(new Event("input", { bubbles: true }));
      p.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { userSel: sels.userSel, passSel: sels.passSel, user, pass }
  );

  await humanDelay();

  // submit form of password
  await Promise.allSettled([
    page.evaluate((passSel) => {
      const p = document.querySelector(passSel);
      const form = p?.closest("form");
      const btn = form?.querySelector("button[type='submit'],input[type='submit']");
      if (btn) btn.click();
      else if (form && typeof form.submit === "function") form.submit();
    }, sels.passSel),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
  ]);

  await humanDelay(800, 1600);

  const stillPassword = await page.$('input[type="password"]');
  if (stillPassword) {
    await dumpDebug(page, "login_failed");
    throw new Error("Login failed (still on login page)");
  }

  await saveCookies(page);
}

/**
 * Entrer plaque: input name="immat", submit le form
 */
async function enterPlate(page, plate) {
  const immSel = "input[name='immat']";
  await page.waitForSelector(immSel, { timeout: 25000 });

  await page.evaluate(
    ({ immSel, plate }) => {
      const el = document.querySelector(immSel);
      if (!el) return;
      el.value = plate;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { immSel, plate }
  );

  await humanDelay();

  await Promise.allSettled([
    page.evaluate((immSel) => {
      const el = document.querySelector(immSel);
      const form = el?.closest("form");
      const btn = form?.querySelector("button[type='submit'],input[type='submit']");
      if (btn) btn.click();
      else if (form && typeof form.submit === "function") form.submit();
    }, immSel),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
  ]);

  await humanDelay(800, 1600);
}

/**
 * Extract models (versions) after plate:
 * - si <select> => options
 * - sinon => liens/boutons cliquables (texte + href)
 * On renvoie {label, modelToken}
 */
async function extractModels(page) {
  await humanDelay(700, 1400);

  return await page.evaluate(() => {
    const clean = (t) => (t || "").replace(/\s+/g, " ").trim();

    // 1) select
    const selects = Array.from(document.querySelectorAll("select")).filter((s) => s.options && s.options.length > 1);
    if (selects.length) {
      const sel = selects[0];
      const opts = Array.from(sel.options)
        .map((o) => ({ label: clean(o.textContent), value: (o.value || "").trim() }))
        .filter((o, idx) => idx !== 0 && o.label);
      return opts.map((o) => ({ label: o.label, modelToken: `select:${o.value}` }));
    }

    // 2) liens sur page (souvent liste versions)
    const links = Array.from(document.querySelectorAll("a"))
      .map((a) => ({ label: clean(a.textContent), href: a.getAttribute("href") || "" }))
      .filter((x) => x.label && x.href && x.href !== "#")
      .slice(0, 50);

    return links.map((x) => ({ label: x.label, modelToken: `href:${x.href}` }));
  });
}

async function pickModel(page, modelToken) {
  if (modelToken.startsWith("select:")) {
    const value = modelToken.slice("select:".length);
    // choisit option et submit
    await page.evaluate((value) => {
      const sel = Array.from(document.querySelectorAll("select")).find((s) => s.options && s.options.length > 1);
      if (!sel) return;
      sel.value = value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      const form = sel.closest("form");
      const btn = form?.querySelector("button[type='submit'],input[type='submit']");
      if (btn) btn.click();
      else if (form && typeof form.submit === "function") form.submit();
    }, value);
  } else if (modelToken.startsWith("href:")) {
    const href = modelToken.slice("href:".length);
    // clique lien par href
    await page.evaluate((href) => {
      const a = Array.from(document.querySelectorAll("a")).find((x) => (x.getAttribute("href") || "") === href);
      if (a) a.click();
      else window.location.href = href;
    }, href);
  } else {
    throw new Error("Unknown modelToken format");
  }

  await Promise.race([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
    sleep(1500),
  ]);

  await humanDelay(800, 1600);
}

/**
 * Extract parts list (simple): on liste liens/boutons "détailler/choisir" OU lignes de table
 * On renvoie {label, partToken}
 */
async function extractParts(page) {
  await humanDelay(700, 1400);

  return await page.evaluate(() => {
    const clean = (t) => (t || "").replace(/\s+/g, " ").trim();

    // 1) liens (souvent navigation vers familles/pièces)
    const links = Array.from(document.querySelectorAll("a"))
      .map((a) => ({ label: clean(a.textContent), href: a.getAttribute("href") || "" }))
      .filter((x) => x.label && x.href && x.href !== "#");

    // heuristique: garder les liens utiles
    const filtered = links
      .filter((x) => x.label.length >= 3)
      .slice(0, 80)
      .map((x) => ({ label: x.label, partToken: `href:${x.href}` }));

    // 2) si rien, on tente lignes table
    if (filtered.length) return filtered;

    const table = document.querySelector("table");
    if (!table) return [];
    const rows = Array.from(table.querySelectorAll("tr")).slice(0, 50);
    return rows
      .map((tr, i) => {
        const txt = clean(tr.textContent);
        if (!txt) return null;
        return { label: txt.slice(0, 120), partToken: `row:${i}` };
      })
      .filter(Boolean);
  });
}

async function pickPart(page, partToken) {
  if (partToken.startsWith("href:")) {
    const href = partToken.slice("href:".length);
    await page.evaluate((href) => {
      const a = Array.from(document.querySelectorAll("a")).find((x) => (x.getAttribute("href") || "") === href);
      if (a) a.click();
      else window.location.href = href;
    }, href);

    await Promise.race([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
      sleep(1500),
    ]);

    await humanDelay(800, 1600);
    return;
  }

  // row:... (fallback) => on clique la ligne si possible
  if (partToken.startsWith("row:")) {
    const idx = Number(partToken.slice("row:".length));
    await page.evaluate((idx) => {
      const table = document.querySelector("table");
      const rows = table ? Array.from(table.querySelectorAll("tr")) : [];
      const tr = rows[idx];
      if (!tr) return;
      // clique un lien dans la ligne si possible
      const a = tr.querySelector("a");
      if (a) a.click();
    }, idx);

    await Promise.race([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
      sleep(1500),
    ]);

    await humanDelay(800, 1600);
    return;
  }

  throw new Error("Unknown partToken format");
}

/**
 * Extract reference (heuristique): cherche "Réf" / "Référence" puis un code alphanum >=6
 */
async function extractReference(page) {
  await humanDelay(700, 1400);

  return await page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();

    // prioritaire: patterns autour de Réf / Référence
    const around = (kw) => {
      const i = text.toLowerCase().indexOf(kw);
      if (i === -1) return "";
      return text.slice(Math.max(0, i - 80), Math.min(text.length, i + 200));
    };

    const chunks = [around("réf"), around("référence"), around("reference"), around("oem")].filter(Boolean);
    const hay = chunks.join("  ||  ") || text;

    // codes possibles (Atelio/OEM) : alphanum 6-25
    const m = hay.match(/\b[A-Z0-9][A-Z0-9\-\.]{5,24}\b/i);
    const candidate = m ? m[0] : "";

    return {
      candidate,
      pageUrl: window.location.href,
      snippet: hay.slice(0, 250),
    };
  });
}

/* =========================
   FLOW PUBLIC
========================= */

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
  await loadCookies(page);
  return { browser, page };
}

async function getModelsByPlate(plate) {
  const { browser, page } = await newBrowserPage();
  try {
    await loginIfNeeded(page);

    // après login, normalement tu arrives dans l'app, et tu as immat
    // si tu as une URL directe du menu immat, mets SUP_URL_MENU
    if (process.env.SUP_URL_MENU) {
      await gotoStable(page, process.env.SUP_URL_MENU);
    }

    await enterPlate(page, plate);

    const models = await extractModels(page);
    await browser.close();
    return models;
  } catch (e) {
    await dumpDebug(page, "get_models_error");
    await browser.close();
    throw e;
  }
}

async function getPartsByPlateAndModel(plate, modelToken) {
  const { browser, page } = await newBrowserPage();
  try {
    await loginIfNeeded(page);
    if (process.env.SUP_URL_MENU) await gotoStable(page, process.env.SUP_URL_MENU);

    await enterPlate(page, plate);
    // on est sur écran versions
    await pickModel(page, modelToken);

    const parts = await extractParts(page);
    await browser.close();
    return parts;
  } catch (e) {
    await dumpDebug(page, "get_parts_error");
    await browser.close();
    throw e;
  }
}

async function getRefByPlateModelPart(plate, modelToken, partToken) {
  const { browser, page } = await newBrowserPage();
  try {
    await loginIfNeeded(page);
    if (process.env.SUP_URL_MENU) await gotoStable(page, process.env.SUP_URL_MENU);

    await enterPlate(page, plate);
    await pickModel(page, modelToken);
    await pickPart(page, partToken);

    const ref = await extractReference(page);
    await browser.close();
    return ref;
  } catch (e) {
    await dumpDebug(page, "get_ref_error");
    await browser.close();
    throw e;
  }
}

module.exports = {
  getModelsByPlate,
  getPartsByPlateAndModel,
  getRefByPlateModelPart,
};