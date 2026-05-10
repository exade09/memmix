const tokenGrid = document.querySelector("#tokenGrid");
const emptyState = document.querySelector("#emptyState");
const scanButton = document.querySelector("#scanButton");
const limitInput = document.querySelector("#limitInput");
const refreshInput = document.querySelector("#refreshInput");
const statusText = document.querySelector("#statusText");
const foundCount = document.querySelector("#foundCount");
const hotCount = document.querySelector("#hotCount");
const updatedAt = document.querySelector("#updatedAt");

let refreshTimer = null;

function money(value) {
  const number = Number(value || 0);
  if (number >= 1_000_000) return `$${(number / 1_000_000).toFixed(2)}M`;
  if (number >= 1_000) return `$${(number / 1_000).toFixed(1)}K`;
  return `$${number.toFixed(0)}`;
}

function percent(value) {
  const number = Number(value || 0);
  return `${number >= 0 ? "+" : ""}${number.toFixed(1)}%`;
}

function ageLabel(minutes) {
  if (minutes === null || minutes === undefined) return "unknown";
  const number = Number(minutes);
  if (number < 60) return `${number.toFixed(0)}m`;
  if (number < 1440) return `${(number / 60).toFixed(1)}h`;
  return `${(number / 1440).toFixed(1)}d`;
}

function signalClass(signal) {
  return String(signal || "weak").toLowerCase();
}

function changeClass(value) {
  return Number(value || 0) >= 0 ? "positive" : "negative";
}

function shortAddress(address) {
  if (!address || address.length <= 14) return address || "";
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

function imageMarkup(token) {
  if (token.image_url) {
    return `<img class="token-image" src="${escapeHtml(token.image_url)}" alt="${escapeHtml(token.token)} logo" loading="lazy" referrerpolicy="no-referrer" />`;
  }
  const letter = String(token.token || "?").slice(0, 1).toUpperCase();
  return `<div class="fallback-image" aria-label="Нет картинки">${escapeHtml(letter)}</div>`;
}

function risksMarkup(risks) {
  if (!risks || risks.length === 0) return "";
  return risks.map((risk) => `<span class="risk">${escapeHtml(risk)}</span>`).join("");
}

function tokenCard(token) {
  const signal = signalClass(token.signal);
  return `
    <article class="token-card">
      <div class="card-main">
        ${imageMarkup(token)}
        <div class="token-title">
          <h2>${escapeHtml(token.token)}</h2>
          <p>${escapeHtml(token.name || token.address)}</p>
          <p>${escapeHtml(token.chain)} · ${escapeHtml(shortAddress(token.address))}</p>
        </div>
        <div class="score">
          <span class="badge ${signal}">${escapeHtml(token.signal)}</span>
          <strong>${Number(token.score || 0).toFixed(1)}</strong>
        </div>
      </div>

      <div class="metrics">
        <div class="metric">
          <span>Liquidity</span>
          <strong>${money(token.liquidity_usd)}</strong>
        </div>
        <div class="metric">
          <span>Volume 1h</span>
          <strong>${money(token.volume_1h)}</strong>
        </div>
        <div class="metric">
          <span>Change 1h</span>
          <strong class="${changeClass(token.price_change_1h)}">${percent(token.price_change_1h)}</strong>
        </div>
        <div class="metric">
          <span>Txns 1h</span>
          <strong>${Number(token.txns_1h || 0).toLocaleString()}</strong>
        </div>
        <div class="metric">
          <span>Buys / Sells</span>
          <strong>${Number(token.buys_1h || 0)} / ${Number(token.sells_1h || 0)}</strong>
        </div>
        <div class="metric">
          <span>Age</span>
          <strong>${ageLabel(token.age_minutes)}</strong>
        </div>
      </div>

      <p class="reason">${escapeHtml(token.why)}</p>
      <div class="risk-list">${risksMarkup(token.risk_flags)}</div>

      <div class="card-actions">
        <a href="${escapeHtml(token.url)}" target="_blank" rel="noreferrer">DexScreener</a>
        <button class="copy-button" type="button" data-address="${escapeHtml(token.address)}">Copy address</button>
      </div>
    </article>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadScan() {
  const limit = Math.min(Math.max(Number(limitInput.value || 100), 1), 100);
  scanButton.disabled = true;
  statusText.textContent = "Сканирую рынок...";

  try {
    const response = await fetch(`/api/scan?limit=${limit}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const tokens = payload.tokens || [];
    tokenGrid.innerHTML = tokens.map(tokenCard).join("");
    emptyState.hidden = tokens.length !== 0;
    foundCount.textContent = String(tokens.length);
    hotCount.textContent = String(tokens.filter((token) => token.signal === "HOT").length);
    updatedAt.textContent = payload.updated_at || "-";
    statusText.textContent = "Данные обновлены";
  } catch (error) {
    statusText.textContent = "Ошибка скана";
    tokenGrid.innerHTML = "";
    emptyState.hidden = false;
    emptyState.querySelector("h2").textContent = "Не удалось загрузить данные";
    emptyState.querySelector("p").textContent = String(error.message || error);
  } finally {
    scanButton.disabled = false;
  }
}

function scheduleRefresh() {
  if (refreshTimer) window.clearInterval(refreshTimer);
  const seconds = Number(refreshInput.value || 0);
  if (seconds > 0) {
    refreshTimer = window.setInterval(loadScan, seconds * 1000);
  }
}

tokenGrid.addEventListener("click", async (event) => {
  const button = event.target.closest(".copy-button");
  if (!button) return;
  await navigator.clipboard.writeText(button.dataset.address || "");
  const oldText = button.textContent;
  button.textContent = "Copied";
  window.setTimeout(() => {
    button.textContent = oldText;
  }, 900);
});

scanButton.addEventListener("click", loadScan);
refreshInput.addEventListener("change", scheduleRefresh);

scheduleRefresh();
loadScan();
