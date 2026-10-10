"use strict";

/* =========================================================
   KreTeX AI - Market dashboard
   Data source: Delta Exchange India (public REST + WebSocket)
   Chart: TradingView Lightweight Charts v4.2.x
   ========================================================= */

const DELTA_API = "https://api.india.delta.exchange";
const DELTA_WS = "wss://public-socket.india.delta.exchange";

let RESOLUTION = "1h";
let RESOLUTION_SEC = 3600;
let WS_CHANNEL = "candlestick_" + RESOLUTION;
let HISTORY_DAYS = 14;


const TIMEFRAME_CONFIG = {
  "1m":   { seconds: 60,    days: 2 },
  "5m":   { seconds: 300,   days: 5 },
  "15m":  { seconds: 900,   days: 14 },
  "30m":  { seconds: 1800,  days: 14 },
  "1h":   { seconds: 3600,  days: 14 },
  "4h":   { seconds: 14400, days: 60 },
  "1d":   { seconds: 86400, days: 365 }
};

const TICKER_REFRESH_MS = 5000;
const FALLBACK_POLL_MS = 10000;
const WS_STALE_MS = 45000;

// Set to true once to see the first live websocket message in console.
const DEBUG = false;

let chart = null;
let candleSeries = null;
let resizeObserver = null;

let currentSymbol = "BTCUSD";
let chartRequestId = 0;
let lastBarTime = 0;

let chartSocket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let staleTimer = null;
let lastSocketMessageAt = 0;
let fallbackTimer = null;
let tickerTimer = null;
let debugLogged = false;

const $ = (id) => document.getElementById(id);

const markets = [
  {
    symbol: "BTCUSD",
    name: "BTC / USD",
    price: "btcPrice",
    change: "btcChange",
    watchPrice: "watchBtcPrice",
    watchChange: "watchBtcChange"
  },
  {
    symbol: "ETHUSD",
    name: "ETH / USD",
    price: "ethPrice",
    change: "ethChange",
    watchPrice: "watchEthPrice",
    watchChange: "watchEthChange"
  },
  {
    symbol: "SOLUSD",
    name: "SOL / USD",
    price: "solPrice",
    change: "solChange",
    watchPrice: "watchSolPrice",
    watchChange: "watchSolChange"
  },
  {
    symbol: "XAUTUSD",
    name: "XAUT / USD",
    price: "xautPrice",
    change: "xautChange",
    watchPrice: "watchXautPrice",
    watchChange: "watchXautChange"
  }
];

/* ---------------------------------------------------------
   Formatting helpers
   --------------------------------------------------------- */

function formatPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";

  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: n >= 1000 ? 2 : 6
  });
}

function formatPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return (n > 0 ? "+" : "") + n.toFixed(2) + "%";
}

function setStatus(message) {
  const el = $("chartStatus");
  if (el) el.textContent = message;
}

function setChange(id, value) {
  const el = $(id);
  if (!el) return;

  el.textContent = formatPercent(value);
  el.classList.toggle("positive", Number(value) > 0);
  el.classList.toggle("negative", Number(value) < 0);
}

function findMarket(symbol) {
  return markets.find((m) => m.symbol === symbol);
}

/* ---------------------------------------------------------
   Ticker (prices + 24h change)
   --------------------------------------------------------- */

function getPrice(row) {
  if (!row) return NaN;

  for (const value of [row.close, row.last_price, row.mark_price, row.spot_price]) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return NaN;
}

function getChange(row) {
  if (!row) return NaN;

  for (const value of [row.ltp_change_24h, row.mark_change_24h, row.change_24h]) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }

  // Fallback: calculate from 24h-ago open price and last price.
  const open = Number(row.open);
  const close = getPrice(row);
  if (Number.isFinite(open) && open > 0 && Number.isFinite(close)) {
    return ((close - open) / open) * 100;
  }

  return NaN;
}

function updateMarketCard(item, row) {
  if (!item || !row) return;

  const price = getPrice(row);
  const change = getChange(row);

  if (Number.isFinite(price)) {
    if ($(item.price)) $(item.price).textContent = formatPrice(price);
    if ($(item.watchPrice)) $(item.watchPrice).textContent = formatPrice(price);

    if (currentSymbol === item.symbol && $("chartLivePrice")) {
      $("chartLivePrice").textContent = formatPrice(price);
    }
  }

  if (Number.isFinite(change)) {
    const el = $(item.change);

    if (el) {
      el.textContent = formatPercent(change) + " · 24H";
      el.classList.toggle("positive", change > 0);
      el.classList.toggle("negative", change < 0);
    }

    setChange(item.watchChange, change);

    if (currentSymbol === item.symbol) {
      setChange("chartLiveChange", change);
    }
  }
}

async function fetchMarkets() {
  try {
    const response = await fetch(DELTA_API + "/v2/tickers", { cache: "no-store" });

    if (!response.ok) throw new Error("Ticker HTTP " + response.status);

    const data = await response.json();
    
    console.log("Ticker API response:", data);

    if (!data.success || !Array.isArray(data.result)) {
      throw new Error("Unexpected ticker response");
    }

    for (const item of markets) {
      const row = data.result.find((r) => r.symbol === item.symbol);

      if (row) {
        updateMarketCard(item, row);
      } else {
        console.warn("Ticker symbol not found:", item.symbol);
      }
    }
  } catch (error) {
    console.error("Delta ticker error:", error);
  }
}

/* ---------------------------------------------------------
   Chart setup
   --------------------------------------------------------- */

function updateChartHeading(symbol) {
  const item = findMarket(symbol);
  const title = $("chartTitle");

  if (title) title.textContent = item ? item.name : symbol;

  document.querySelectorAll("[data-symbol], [data-chart-symbol]").forEach((button) => {
    const buttonSymbol = button.dataset.symbol || button.dataset.chartSymbol;
    button.classList.toggle("active", buttonSymbol === symbol);
  });

  const livePrice = $("chartLivePrice");
  if (livePrice) livePrice.textContent = "--";

  const liveChange = $("chartLiveChange");
  if (liveChange) {
    liveChange.textContent = "--";
    liveChange.classList.remove("positive", "negative");
  }
}

function createChart() {
  const container = $("chart");

  if (!container) {
    console.error('Missing chart container: id="chart"');
    setStatus("Chart container not found");
    return;
  }

  if (!window.LightweightCharts) {
    console.error("Lightweight Charts library did not load");
    setStatus("Chart library not loaded");
    return;
  }

  if (chart) return;

  chart = LightweightCharts.createChart(container, {
    width: container.clientWidth || 600,
    height: Math.max(300, container.clientHeight || 420),

    layout: {
      background: { color: "#0b0f0d" },
      textColor: "#b9c3bd"
    },

    grid: {
      vertLines: { color: "#202923" },
      horzLines: { color: "#202923" }
    },

    rightPriceScale: {
      borderColor: "#303a33",
      autoScale: true,
      scaleMargins: { top: 0.12, bottom: 0.12 }
    },

    timeScale: {
      borderColor: "#303a33",
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 5,
      barSpacing: 8,
      minBarSpacing: 2
    },

    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false
    },

    handleScale: {
      mouseWheel: true,
      pinch: true,
      axisPressedMouseMove: true
    },

    localization: {
      priceFormatter: formatPrice
    }
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: "#b6f36b",
    downColor: "#ff657a",
    borderUpColor: "#b6f36b",
    borderDownColor: "#ff657a",
    wickUpColor: "#b6f36b",
    wickDownColor: "#ff657a",
    priceLineVisible: true,
    lastValueVisible: true
  });

  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      if (!chart) return;

      const width = container.clientWidth;
      const height = container.clientHeight;

      if (width > 0 && height > 0) {
        chart.applyOptions({ width, height });
      }
    });

    resizeObserver.observe(container);
  }
}

/* ---------------------------------------------------------
   Candle normalising
   --------------------------------------------------------- */

// Converts seconds / milliseconds / microseconds / ISO strings to Unix seconds.
function toUnixSeconds(value) {
  if (value === null || value === undefined || value === "") return NaN;

  if (typeof value === "string" && !/^\d+(\.\d+)?$/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : NaN;
  }

  let t = Number(value);
  if (!Number.isFinite(t)) return NaN;

  if (t > 1e14) t = t / 1e6;        // microseconds
  else if (t > 1e11) t = t / 1e3;   // milliseconds

  return Math.floor(t);
}

function bucketTime(seconds) {
  return Math.floor(seconds / RESOLUTION_SEC) * RESOLUTION_SEC;
}

function normalizeCandle(c) {
  const time = toUnixSeconds(c.time ?? c.t);

  const open = Number(c.open ?? c.o);
  const high = Number(c.high ?? c.h);
  const low = Number(c.low ?? c.l);
  const close = Number(c.close ?? c.c);

  if (
    !Number.isFinite(time) ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    open <= 0 || high <= 0 || low <= 0 || close <= 0
  ) {
    return null;
  }

  return {
    time,
    open,
    high: Math.max(open, high, low, close),
    low: Math.min(open, high, low, close),
    close
  };
}

async function fetchCandles(symbol, startSec, endSec) {
  const params = new URLSearchParams({
    resolution: RESOLUTION,
    symbol,
    start: String(startSec),
    end: String(endSec)
  });

  const response = await fetch(
    DELTA_API + "/v2/history/candles?" + params.toString(),
    { cache: "no-store" }
  );

  if (!response.ok) throw new Error("Candles HTTP " + response.status);

  const data = await response.json();
  console.log("TIMEFRAME API:", RESOLUTION, data);
   
  if (!data.success || !Array.isArray(data.result)) {
    throw new Error("Unexpected candle response");
  }

  return data.result
    .map(normalizeCandle)
    .filter(Boolean)
    .sort((a, b) => a.time - b.time)
    .filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time);
}

/* ---------------------------------------------------------
   Load historical candles for a symbol
   --------------------------------------------------------- */

async function loadChart(symbol) {
  currentSymbol = symbol;
  const requestId = ++chartRequestId;

  updateChartHeading(symbol);
  createChart();

  if (!chart || !candleSeries) return;

  closeLiveSocket();
  stopFallbackPolling();
  lastBarTime = 0;
  candleSeries.setData([]);

  // Show the price we already have from the ticker.
  fetchMarkets();

  setStatus(symbol + " · Loading historical candles...");

  try {
    const end = Math.floor(Date.now() / 1000);
    const start = end - HISTORY_DAYS * 24 * 60 * 60;

    const candles = await fetchCandles(symbol, start, end);

    if (requestId !== chartRequestId) return;

    if (DEBUG) console.log("Delta candles:", symbol, candles.length, candles.slice(-3));

    if (candles.length < 2) {
      setStatus(symbol + " · Not enough historical candles returned");
      console.warn("Insufficient candles for", symbol, candles);
      return;
    }

    candleSeries.setData(candles);
    lastBarTime = candles[candles.length - 1].time;

    chart.timeScale().fitContent();

    setStatus(symbol + " · Delta Exchange India · Historical candles loaded");

    connectLiveChart(symbol);
    startFallbackPolling(symbol);
  } catch (error) {
    if (requestId !== chartRequestId) return;
    console.error("Delta candle request failed:", error);
    setStatus(symbol + " · Could not load candles · See console");
  }
}

/* ---------------------------------------------------------
   Live candle updates
   --------------------------------------------------------- */

function applyLiveCandle(candle) {
  if (!candleSeries || !candle) return;

  // Lightweight Charts throws if we update a bar older than the latest one.
  if (lastBarTime && candle.time < lastBarTime) return;

  try {
    candleSeries.update(candle);
    lastBarTime = Math.max(lastBarTime, candle.time);

    const livePrice = $("chartLivePrice");
    if (livePrice) livePrice.textContent = formatPrice(candle.close);
  } catch (error) {
    console.warn("Candle update skipped:", error);
  }
}

function closeLiveSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (staleTimer) {
    clearInterval(staleTimer);
    staleTimer = null;
  }

  if (chartSocket) {
    chartSocket.onopen = null;
    chartSocket.onmessage = null;
    chartSocket.onerror = null;
    chartSocket.onclose = null;

    try {
      chartSocket.close();
    } catch (e) {
      /* ignore */
    }

    chartSocket = null;
  }
}

function scheduleReconnect(symbol) {
  if (reconnectTimer) clearTimeout(reconnectTimer);

  const delay = Math.min(30000, 2000 * Math.pow(2, reconnectAttempts));
  reconnectAttempts += 1;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (symbol === currentSymbol) connectLiveChart(symbol);
  }, delay);
}

function connectLiveChart(symbol) {
  closeLiveSocket();
  debugLogged = false;

  let socket;

  try {
    socket = new WebSocket(DELTA_WS);
  } catch (error) {
    console.error("WebSocket could not be created:", error);
    scheduleReconnect(symbol);
    return;
  }

  chartSocket = socket;

  socket.onopen = () => {
    if (socket !== chartSocket) return;

    reconnectAttempts = 0;
    lastSocketMessageAt = Date.now();

    socket.send(JSON.stringify({ type: "enable_heartbeat" }));

    socket.send(JSON.stringify({
      type: "subscribe",
      payload: {
        channels: [{ name: WS_CHANNEL, symbols: [symbol] }]
      }
    }));

    setStatus(symbol + " · Delta live candle feed connected");

    // If the feed goes silent, drop it and reconnect.
    staleTimer = setInterval(() => {
      if (socket !== chartSocket) return;

      if (Date.now() - lastSocketMessageAt > WS_STALE_MS) {
        console.warn("Live feed stale, reconnecting...");
        closeLiveSocket();
        if (symbol === currentSymbol) connectLiveChart(symbol);
      }
    }, 10000);
  };

  socket.onmessage = (event) => {
    if (socket !== chartSocket || symbol !== currentSymbol) return;

    lastSocketMessageAt = Date.now();

    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      return;
    }

    if (!message || message.type !== WS_CHANNEL) return;

    if (DEBUG && !debugLogged) {
      console.log("LIVE MSG:", message);
      debugLogged = true;
    }

    const messageSymbol = message.symbol || message.sy;
    if (messageSymbol && messageSymbol !== symbol) return;

    // Use the candle start time if present, else the message time.
    // Either way, snap to the 1h bucket so we update the current candle
    // instead of creating a new one on every tick.
    let t = toUnixSeconds(
      message.candle_start_time ?? message.start_time ?? message.ts ?? message.timestamp
    );
    if (!Number.isFinite(t)) t = Math.floor(Date.now() / 1000);

    const candle = normalizeCandle({
      time: bucketTime(t),
      open: message.open ?? message.o,
      high: message.high ?? message.h,
      low: message.low ?? message.l,
      close: message.close ?? message.c
    });

    if (!candle) {
      console.warn("Invalid live candle:", message);
      return;
    }

    applyLiveCandle(candle);
    setStatus(symbol + " · Live · " + formatPrice(candle.close));
  };

  socket.onerror = (error) => {
    console.warn("Delta candle socket error:", error);
  };

  socket.onclose = () => {
    if (socket !== chartSocket) return;

    chartSocket = null;
    setStatus(symbol + " · Live feed disconnected · Reconnecting...");
    scheduleReconnect(symbol);
  };
}

/* ---------------------------------------------------------
   REST fallback: keeps the last candles fresh if WebSocket is down
   --------------------------------------------------------- */

async function refreshLatestCandles(symbol) {
  try {
    const end = Math.floor(Date.now() / 1000);
    const start = end - 3 * RESOLUTION_SEC;
    const candles = await fetchCandles(symbol, start, end);

    if (symbol !== currentSymbol) return;

    candles.forEach(applyLiveCandle);
  } catch (error) {
    console.warn("Fallback candle refresh failed:", error);
  }
}

function startFallbackPolling(symbol) {
  stopFallbackPolling();

  fallbackTimer = setInterval(() => {
    const socketOpen = chartSocket && chartSocket.readyState === WebSocket.OPEN;
    const socketFresh = Date.now() - lastSocketMessageAt < WS_STALE_MS;

    if (!socketOpen || !socketFresh) {
      refreshLatestCandles(symbol);
    }
  }, FALLBACK_POLL_MS);
}

function stopFallbackPolling() {
  if (fallbackTimer) {
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }
}

/* ---------------------------------------------------------
   Init
   --------------------------------------------------------- */

function initApp() {
  createChart();

  fetchMarkets();

  if (tickerTimer) clearInterval(tickerTimer);
  tickerTimer = setInterval(fetchMarkets, TICKER_REFRESH_MS);

  document.querySelectorAll("[data-symbol], [data-chart-symbol]").forEach((button) => {
    button.addEventListener("click", () => {
      const symbol = button.dataset.symbol || button.dataset.chartSymbol;

      if (symbol && findMarket(symbol)) {
        loadChart(symbol);
      }
    });
  });
  
const timeframeToggle = document.getElementById("timeframeToggle");
const timeframeMenu = document.getElementById("timeframeMenu");
const selectedTimeframe = document.getElementById("selectedTimeframe");

if (timeframeToggle && timeframeMenu) {
  timeframeToggle.addEventListener("click", () => {
    timeframeMenu.hidden = !timeframeMenu.hidden;
  });

  document.querySelectorAll(".timeframe-option").forEach((button) => {
    button.addEventListener("click", () => {
      const timeframe = button.dataset.timeframe;
      const config = TIMEFRAME_CONFIG[timeframe];

      if (!config) return;

      RESOLUTION = timeframe;
      RESOLUTION_SEC = config.seconds;
      HISTORY_DAYS = config.days;
      WS_CHANNEL = "candlestick_" + RESOLUTION;

      selectedTimeframe.textContent = button.textContent.trim();
      timeframeMenu.hidden = true;

      loadChart(currentSymbol);
    });
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".timeframe-dropdown")) {
      timeframeMenu.hidden = true;
    }
  });
}
  loadChart("BTCUSD");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp, { once: true });
} else {
  initApp();
}
