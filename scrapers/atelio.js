const puppeteer = require("puppeteer");
const fs = require("fs");

const COOKIE_PATH = "/tmp/atelio-cookies.json";
const BASE = "https://www.atelio-chiffrage.com";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const humanDelay = async (min = 500, max = 1200) => sleep(Math.floor(min + Math.random() * (max - min)));

async function gotoStable(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await humanDelay();
  await sleep(250);
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

/* =========================
   LOGIN + PLAQUE
========================= */
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

/* =========================
   MODELS
========================= */
async function extractModels(page) {
  await humanDelay(600, 1200);
  await page.waitForSelector("tr.version", { timeout: 25000 });

  return await page.evaluate(() => {
    const clean = (t) => (t || "").replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim();

    const rows = Array.from(document.querySelectorAll("tr.version"));
    const out = rows
      .map((tr) => {
        const onclick = tr.getAttribute("onclick") || "";
        const m = onclick.match(/choose_version\((\d+)\)/);
        const id = m ? m[1] : "";
        const label = clean(tr.textContent);
        if (!id || !label) return null;
        return { label, modelToken: `choose:${id}` };
      })
      .filter(Boolean);

    const seen = new Set();
    return out.filter((x) => {
      if (seen.has(x.modelToken)) return false;
      seen.add(x.modelToken);
      return true;
    });
  });
}

async function pickModel(page, modelToken) {
  if (!modelToken.startsWith("choose:")) throw new Error("Unknown modelToken format");
  const id = modelToken.slice("choose:".length);

  await page.evaluate((id) => {
    if (typeof window.choose_version === "function") {
      window.choose_version(Number(id));
      return;
    }
    const tr = Array.from(document.querySelectorAll("tr.version")).find((r) => {
      const oc = r.getAttribute("onclick") || "";
      return oc.includes(`choose_version(${id})`);
    });
    if (tr) tr.click();
  }, id);

  await Promise.race([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
    sleep(1800),
  ]);

  await humanDelay(800, 1600);
}

/* =========================
   PARTS / PLANCHES
   ✅ On renvoie partToken = planche:CODE (propre)
========================= */
async function extractParts(page) {
  await humanDelay(800, 1500);

  return await page.evaluate(() => {
    const clean = (t) => (t || "").replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim();
    const isNoise = (label) => {
      const s = label.toLowerCase();
      return !label || s.includes("assistance") || s.includes("hotline") || s.includes("déconnexion") || s.includes("deconnexion");
    };

    const out = [];

    // On prend les éléments onclick contenant codePlanche
    const nodes = Array.from(document.querySelectorAll("[onclick]"));
    for (const el of nodes) {
      const label = clean(el.textContent || el.getAttribute("value") || "");
      if (isNoise(label)) continue;

      const oc = (el.getAttribute("onclick") || "").trim();
      const m = oc.match(/codePlanche=(\d+)/i);
      if (!m) continue;

      out.push({ label, partToken: `planche:${m[1]}` });
    }

    // dédoublonnage
    const seen = new Set();
    return out.filter((x) => {
      const k = x.partToken;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  });
}

async function openPlanche(page, partToken) {
  if (!partToken.startsWith("planche:")) throw new Error("partToken must be planche:XXXX");
  const code = partToken.slice("planche:".length);
  const url = `${BASE}/SelectionPiece.html?method=affichePlanche&codePlanche=${encodeURIComponent(code)}`;
  await gotoStable(page, url);
}

/* =========================
   PIECES (dans une planche)
   ✅ On renvoie pieceToken = row:N ou href:/...
========================= */
async function extractPieces(page) {
  await humanDelay(800, 1500);

  await Promise.race([page.waitForSelector("table", { timeout: 15000 }), sleep(1200)]);

  return await page.evaluate(() => {
    const clean = (t) => (t || "").replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim();

    const table = document.querySelector("table");
    if (!table) return [];

    const rows = Array.from(table.querySelectorAll("tr"));
    const out = [];

    for (let i = 0; i < rows.length; i++) {
      const tr = rows[i];
      const txt = clean(tr.textContent);
      if (!txt || txt.length < 3) continue;

      // si lien direct dans la ligne
      const a = tr.querySelector("a[href]");
      if (a) {
        const href = (a.getAttribute("href") || "").trim();
        if (href && href !== "#") {
          out.push({ label: txt.slice(0, 160), pieceToken: `href:${href}` });
          continue;
        }
      }

      // sinon on clique la ligne par index
      out.push({ label: txt.slice(0, 160), pieceToken: `row:${i}` });
    }

    // dédoublonnage basique
    const seen = new Set();
    return out.filter((x) => {
      const k = x.pieceToken;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 200);
  });
}

async function pickPiece(page, pieceToken) {
  if (pieceToken.startsWith("href:")) {
    const href = pieceToken.slice("href:".length);
    const abs = href.startsWith("http") ? href : `${BASE}${href.startsWith("/") ? "" : "/"}${href}`;
    await gotoStable(page, abs);
    return;
  }

  if (pieceToken.startsWith("row:")) {
    const idx = Number(pieceToken.slice("row:".length));
    await page.evaluate((idx) => {
      const table = document.querySelector("table");
      if (!table) return;
      const rows = Array.from(table.querySelectorAll("tr"));
      const tr = rows[idx];
      if (!tr) return;
      // tente de cliquer un élément cliquable dans la ligne
      const a = tr.querySelector("a");
      if (a) a.click();
      else tr.click();
    }, idx);

    await Promise.race([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
      sleep(1800),
    ]);
    await humanDelay(800, 1600);
    return;
  }

  throw new Error("Unknown pieceToken format");
}

/* =========================
   REF
========================= */
async function extractReference(page) {
  await humanDelay(700, 1400);

  return await page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const lower = text.toLowerCase();

    const pickWindow = (kw) => {
      const i = lower.indexOf(kw);
      if (i === -1) return "";
      return text.slice(Math.max(0, i - 80), Math.min(text.length, i + 260));
    };

    const hay = [pickWindow("réf"), pickWindow("référence"), pickWindow("reference"), pickWindow("oem")]
      .filter(Boolean)
      .join(" || ") || text;

    const m = hay.match(/\b[A-Z0-9][A-Z0-9\-\.]{5,24}\b/i);
    return { candidate: m ? m[0] : "", pageUrl: window.location.href, snippet: hay.slice(0, 260) };
  });
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
  await loadCookies(page);
  return { browser, page };
}

/* =========================
   API PUBLIC
========================= */
async function getModelsByPlate(plate) {
  const { browser, page } = await newBrowserPage();
  try {
    await loginIfNeeded(page);
    if (process.env.SUP_URL_MENU) await gotoStable(page, process.env.SUP_URL_MENU);
    await enterPlate(page, plate);
    const models = await extractModels(page);
    if (!models.length) await dumpDebug(page, "models_empty");
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
    await pickModel(page, modelToken);
    const parts = await extractParts(page);
    if (!parts.length) await dumpDebug(page, "parts_empty");
    await browser.close();
    return parts;
  } catch (e) {
    await dumpDebug(page, "get_parts_error");
    await browser.close();
    throw e;
  }
}

async function getPiecesByPlateModelPlanche(plate, modelToken, partToken) {
  const { browser, page } = await newBrowserPage();
  try {
    await loginIfNeeded(page);
    if (process.env.SUP_URL_MENU) await gotoStable(page, process.env.SUP_URL_MENU);

    await enterPlate(page, plate);
    await pickModel(page, modelToken);
    await openPlanche(page, partToken);

    const pieces = await extractPieces(page);
    if (!pieces.length) await dumpDebug(page, "pieces_empty");

    await browser.close();
    return pieces;
  } catch (e) {
    await dumpDebug(page, "get_pieces_error");
    await browser.close();
    throw e;
  }
}

async function getRefByPlateModelPlanchePiece(plate, modelToken, partToken, pieceToken) {
  const { browser, page } = await newBrowserPage();
  try {
    await loginIfNeeded(page);
    if (process.env.SUP_URL_MENU) await gotoStable(page, process.env.SUP_URL_MENU);

    await enterPlate(page, plate);
    await pickModel(page, modelToken);
    await openPlanche(page, partToken);
    await pickPiece(page, pieceToken);

    const ref = await extractReference(page);
    if (!ref.candidate) await dumpDebug(page, "ref_empty");

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
  getPiecesByPlateModelPlanche,
  getRefByPlateModelPlanchePiece,
};