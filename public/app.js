const $ = id => document.getElementById(id);

let selectedBot = null;
let logTimer = null;

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "حدث خطأ");
  }

  return data;
}

function message(text) {
  $("message").textContent = text;
}

function showDashboard() {
  $("login").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
  loadBots();
}

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    await api("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        password: $("password").value
      })
    });

    $("password").value = "";
    message("تم تسجيل الدخول");
    showDashboard();

  } catch (error) {
    message(error.message);
  }
});

$("uploadForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const formData = new FormData(event.target);

    const result = await api("/api/bots", {
      method: "POST",
      body: formData
    });

    message("تم رفع البوت: " + result.id);
    event.target.reset();
    loadBots();

  } catch (error) {
    message(error.message);
  }
});

async function loadBots() {
  try {
    const bots = await api("/api/bots");

    $("bots").innerHTML = "";

    if (bots.length === 0) {
      $("bots").textContent = "ما عندك بوتات بعد.";
      return;
    }

    for (const bot of bots) {
      const card = document.createElement("div");
      card.className = "bot";

      const name = document.createElement("h3");
      name.textContent = bot.id;

      const status = document.createElement("p");
      status.className = "status";
      status.textContent = bot.running
        ? "🟢 يعمل"
        : "🔴 متوقف";

      const consoleButton = document.createElement("button");
      consoleButton.textContent = "عرض Console";
      consoleButton.onclick = () => selectBot(bot.id);

      const startButton = document.createElement("button");
      startButton.textContent = "تشغيل";
      startButton.disabled = bot.running;
      startButton.onclick = () => botAction(bot.id, "start");

      const stopButton = document.createElement("button");
      stopButton.textContent = "إيقاف";
      stopButton.className = "stop";
      stopButton.disabled = !bot.running;
      stopButton.onclick = () => botAction(bot.id, "stop");

      card.append(
        name,
        status,
        consoleButton,
        startButton,
        stopButton
      );

      $("bots").appendChild(card);
    }

  } catch (error) {
    message(error.message);
  }
}

async function botAction(id, action) {
  try {
    await api(
      `/api/bots/${encodeURIComponent(id)}/${action}`,
      { method: "POST" }
    );

    message(
      action === "start"
        ? "تم طلب تشغيل البوت"
        : "تم طلب إيقاف البوت"
    );

    await loadBots();
    await selectBot(id);

  } catch (error) {
    message(error.message);
  }
}

async function selectBot(id) {
  selectedBot = id;

  $("consoleTitle").textContent = "Console — " + id;

  await loadLogs();

  if (logTimer) {
    clearInterval(logTimer);
  }

  logTimer = setInterval(loadLogs, 3000);
}

async function loadLogs() {
  if (!selectedBot) return;

  try {
    const data = await api(
      `/api/bots/${encodeURIComponent(selectedBot)}/logs`
    );

    $("logs").textContent =
      data.logs.join("\n") || "لا توجد سجلات بعد.";

    $("logs").scrollTop = $("logs").scrollHeight;

  } catch (error) {
    $("logs").textContent = error.message;
  }
}

$("refresh").addEventListener("click", () => {
  loadBots();
  loadLogs();
});

$("logout").addEventListener("click", async () => {
  try {
    await api("/api/logout", {
      method: "POST"
    });

    location.reload();

  } catch (error) {
    message(error.message);
  }
});

(async () => {
  try {
    await api("/api/me");
    showDashboard();
  } catch {
    // المستخدم يحتاج يسجل الدخول أولاً
  }
})();
            
