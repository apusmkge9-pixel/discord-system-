const express = require("express");
const session = require("express-session");
const multer = require("multer");
const unzipper = require("unzipper");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;
const PANEL_PASSWORD = process.env.PANEL_PASSWORD;
const DATA_DIR = path.join(__dirname, "bot-data");
const upload = multer({
  dest: path.join(__dirname, "uploads"),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    cb(null, path.extname(file.originalname).toLowerCase() === ".zip")
});

if (!PANEL_PASSWORD || PANEL_PASSWORD.length < 12) {
  console.error("Set PANEL_PASSWORD to a strong password (at least 12 characters).");
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });

app.use(express.json({ limit: "100kb" }));
app.use(session({
  name: "mbh.sid",
  secret: process.env.SESSION_SECRET || require("crypto").randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, "public")));

function auth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  return res.status(401).json({ error: "سجّل الدخول أولاً" });
}
const bots = new Map();

function safeId(s) {
  return /^[a-zA-Z0-9_-]{1,40}$/.test(s);
}
function botDir(id) { return path.join(DATA_DIR, id); }

app.post("/api/login", (req, res) => {
  if (!req.body || req.body.password !== PANEL_PASSWORD) return res.status(401).json({ error: "كلمة المرور غير صحيحة" });
  req.session.loggedIn = true;
  res.json({ ok: true });
});
app.post("/api/logout", auth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});
app.get("/api/bots", auth, (_req, res) => {
  const ids = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).filter(id => safeId(id) && fs.statSync(botDir(id)).isDirectory()) : [];
  res.json(ids.map(id => ({ id, running: !!bots.get(id)?.child, logs: bots.get(id)?.logs || [] })));
});

app.post("/api/bots", auth, upload.single("archive"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "ارفع ملف ZIP فقط" });
  const id = String(req.body.name || "").trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40);
  if (!id) { fs.unlinkSync(req.file.path); return res.status(400).json({ error: "اكتب اسماً صالحاً" }); }
  const dest = botDir(id);
  if (fs.existsSync(dest)) { fs.unlinkSync(req.file.path); return res.status(409).json({ error: "هذا الاسم موجود مسبقاً" }); }
  try {
    fs.mkdirSync(dest, { recursive: true });
    const directory = await unzipper.Open.file(req.file.path);
    for (const entry of directory.files) {
      if (entry.type === "Directory") continue;
      const normalized = path.posix.normalize(entry.path.replace(/\\/g, "/"));
      if (normalized.startsWith("../") || normalized === ".." || path.isAbsolute(normalized)) {
        throw new Error("ملف ZIP يحتوي مساراً غير آمن");
      }
      const target = path.join(dest, normalized);
      if (!target.startsWith(dest + path.sep)) throw new Error("مسار غير آمن");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await new Promise((resolve, reject) => {
        entry.stream().pipe(fs.createWriteStream(target)).on("finish", resolve).on("error", reject);
      });
    }
    if (!fs.existsSync(path.join(dest, "package.json")) || !fs.existsSync(path.join(dest, "index.js"))) {
      throw new Error("لازم ZIP يحتوي package.json و index.js في المجلد الرئيسي");
    }
    bots.set(id, { child: null, logs: [`تم رفع ${id}`] });
    res.json({ ok: true, id });
  } catch (e) {
    fs.rmSync(dest, { recursive: true, force: true });
    res.status(400).json({ error: e.message || "تعذر فك ZIP" });
  } finally {
    fs.rmSync(req.file.path, { force: true });
  }
});

app.post("/api/bots/:id/start", auth, (req, res) => {
  const id = req.params.id;
  if (!safeId(id) || !fs.existsSync(path.join(botDir(id), "index.js"))) return res.status(404).json({ error: "البوت غير موجود" });
  const state = bots.get(id) || { child: null, logs: [] };
  if (state.child) return res.json({ ok: true, message: "البوت يعمل بالفعل" });
  const dir = botDir(id);
  state.logs = (state.logs || []).slice(-150);
  const add = (chunk) => {
    state.logs.push(String(chunk).trimEnd().slice(0, 2000));
    state.logs = state.logs.slice(-150);
  };
  // Install this bot's dependencies before starting it.
  const installer = spawn("npm", ["install", "--omit=dev"], { cwd: dir, env: { ...process.env }, shell: false });
  state.child = installer;
  bots.set(id, state);
  installer.stdout.on("data", add);
  installer.stderr.on("data", add);
  installer.on("error", e => { add("تعذر تثبيت المكتبات: " + e.message); state.child = null; });
  installer.on("close", code => {
    if (state.child !== installer) return;
    if (code !== 0) { add(`فشل npm install (code ${code})`); state.child = null; return; }
    add("اكتمل تثبيت المكتبات، جارٍ تشغيل البوت...");
    const child = spawn("npm", ["start"], { cwd: dir, env: { ...process.env }, shell: false });
    state.child = child;
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    child.on("error", e => { add("تعذر التشغيل: " + e.message); state.child = null; });
    child.on("close", code => { add(`انتهى البوت (code ${code})`); state.child = null; });
  });
  res.json({ ok: true, message: "بدأ تثبيت المكتبات ثم التشغيل" });
});
app.post("/api/bots/:id/stop", auth, (req, res) => {
  const state = bots.get(req.params.id);
  if (!state || !state.child) return res.json({ ok: true, message: "البوت متوقف" });
  state.child.kill("SIGTERM");
  state.logs.push("تم طلب إيقاف البوت");
  res.json({ ok: true });
});
app.get("/api/bots/:id/logs", auth, (req, res) => {
  const state = bots.get(req.params.id);
  res.json({ logs: state?.logs || [], running: !!state?.child });
});
app.get("/api/me", auth, (_req, res) => res.json({ ok: true }));

app.listen(PORT, "0.0.0.0", () => console.log(`My Bot Hosting listening on ${PORT}`));
