"use strict";

let chart = null;
let candleSeries = null;
let currentSymbol = "BTCUSDT";
let chartRequestId = 0;

const $ = (id) => document.getElementById(id);

function formatPrice(value) {
  if (!Number.isFinite(value)) return "—";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 2 : 4
  }).format(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "—";

  const sign = value > 0 ? "+" : "";
  return sign + value.toFixed(2) + "%";
}

function setChange(id, value) {
  const element = $(id);
  if (!element) return;

  element.textContent = formatPercent(value);
  element.classList.toggle("positive", value > 0);
  element.classList.toggle("negative", value < 0);
}

async function fetchMarkets() {
  try {
    const response = await fetch(
      "https://api.binance.com/api/v3/ticker/24hr",
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("Market API HTTP " + response.status);
    }

    const rows = await response.json();
    const markets = {};

    for (const symbol of ["BTCUSDT", "ETHUSDT", "SOLUSDT"]) {
      const row = rows.find((item) => item.symbol === symbol);
      if (row) markets[symbol] = row;
    }

    const config = [
      {
        symbol: "BTCUSDT",
        price: "btcPrice",
        change: "btcChange",
        watchPrice: "watchBtcPrice",
        watchChange: "watchBtcChange"
      },
      {
        symbol: "ETHUSDT",
        price: "ethPrice",
        change: "ethChange",
        watchPrice: "watchEthPrice",
        watchChange: "watchEthChange"
      },
      {
        symbol: "SOLUSDT",
        price: "solPrice",
        change: "solChange",
        watchPrice: "watchSolPrice",
        watchChange: "watchSolChange"
      }
    ];

    for (const item of config) {
      const market = markets[item.symbol];
      if (!market) continue;

      const price = Number(market.lastPrice);
      const change = Number(market.priceChangePercent);

      if ($(item.price)) $(item.price).textContent = formatPrice(price);
      if ($(item.watchPrice)) {
        $(item.watchPrice).textContent = formatPrice(price);
      }

      if ($(item.change)) {
        $(item.change).textContent = formatPercent(change) + " · 24H";
        $(item.change).classList.toggle("positive", change > 0);
        $(item.change).classList.toggle("negative", change < 0);
      }

      setChange(item.watchChange, change);
    }

    const status = $("chartStatus");
    if (status && !status.dataset.chartError) {
      status.textContent = "Public market feed connected · Prices refresh every 30 seconds";
    }
  } catch (error) {
    console.error("Market prices failed:", error);

    const status = $("chartStatus");
    if (status && !status.dataset.chartError) {
      status.textContent = "Market feed unavailable. Reload or try again later.";
    }
  }
}

function createChartIfNeeded() {
  if (chart) return;

  const container = $("chart");

  if (!container) {
    throw new Error("Chart container is missing");
  }

  if (typeof LightweightCharts === "undefined") {
    throw new Error("Chart library did not load");
  }

  chart = LightweightCharts.createChart(container, {
    width: container.clientWidth || 300,
    height: 330,
    layout: {
      background: { color: "#171a16" },
      textColor: "#929b8b"
    },
    grid: {
      vertLines: { color: "#30372c" },
      horzLines: { color: "#30372c" }
    },
    rightPriceScale: {
      borderColor: "#30372c"
    },
    timeScale: {
      borderColor: "#30372c",
      timeVisible: true,
      secondsVisible: false
    },
    crosshair: {
      vertLine: { color: "#c5f46766" },
      horzLine: { color: "#c5f46766" }
    }
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: "#75df9b",
    downColor: "#ff7777",
    borderUpColor: "#75df9b",
    borderDownColor: "#ff7777",
    wickUpColor: "#75df9b",
    wickDownColor: "#ff7777"
  });

  if (window.ResizeObserver) {
    const observer = new ResizeObserver(() => {
      if (chart && container.clientWidth) {
        chart.applyOptions({ width: container.clientWidth });
      }
    });
    observer.observe(container);
  } else {
    window.addEventListener("resize", () => {
      if (chart && container.clientWidth) {
        chart.applyOptions({ width: container.clientWidth });
      }
    });
  }
}

async function loadChart(symbol) {
  currentSymbol = symbol;
  const requestId = ++chartRequestId;

  const title = $("chartTitle");
  const status = $("chartStatus");

  if (title) title.textContent = symbol.replace("USDT", "") + " / USDT";

  if (status) {
    status.dataset.chartError = "";
    status.textContent = "Loading " + symbol.replace("USDT", "") + " candles…";
  }

  document.querySelectorAll("#chartTabs .tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.symbol === symbol);
  });

  try {
    createChartIfNeeded();

    const url =
      "https://api.binance.com/api/v3/klines" +
      "?symbol=" + encodeURIComponent(symbol) +
      "&interval=1h&limit=100&_= " .trim() + Date.now();

    const response = await fetch(url, { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Binance candle API HTTP " + response.status);
    }

    const rows = await response.json();

    if (requestId !== chartRequestId || symbol !== currentSymbol) return;

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("No candle data returned");
    }

    const candles = rows.map((row) => ({
      time: Math.floor(Number(row[0]) / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4])
    }));

    if (candles.some((candle) =>
      !Number.isFinite(candle.time) ||
      !Number.isFinite(candle.open) ||
      !Number.isFinite(candle.high) ||
      !Number.isFinite(candle.low) ||
      !Number.isFinite(candle.close)
    )) {
      throw new Error("Invalid candle values");
    }

    candles.sort((a, b) => a.time - b.time);

    const uniqueCandles = candles.filter((candle, index, array) =>
      index === 0 || candle.time > array[index - 1].time
    );

    candleSeries.setData(uniqueCandles);
    chart.timeScale().fitContent();

    if (status) {
      status.dataset.chartError = "";
      status.textContent =
        symbol.replace("USDT", "") + "/USDT · " +
        uniqueCandles.length + " hourly candles loaded · Latest close: " +
        formatPrice(uniqueCandles[uniqueCandles.length - 1].close);
    }
  } catch (error) {
    if (requestId !== chartRequestId) return;

    console.error("Chart loading failed:", error);

    if (status) {
      status.dataset.chartError = "true";
      status.textContent = "Chart error: " + error.message;
    }

    if (title) {
      title.textContent = symbol.replace("USDT", "") + " / USDT";
    }
  }
}

function initApp() {
  document.querySelectorAll("#chartTabs .tab").forEach((button) => {
    button.addEventListener("click", () => {
      loadChart(button.dataset.symbol);
    });
  });

  const menuButton = $("menuButton");
  const sidebar = $("sidebar");

  if (menuButton && sidebar) {
    menuButton.addEventListener("click", () => {
      sidebar.classList.toggle("open");
    });
  }

  fetchMarkets();
  loadChart("BTCUSDT");

  window.setInterval(fetchMarkets, 30000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
