
"use strict";

// VantaTradeAI — Delta Exchange India public market data
// Public data only. No order placement or private API keys.

const DELTA_API = "https://api.india.delta.exchange";
const DELTA_WS = "wss://public-socket.india.delta.exchange";

let chart = null;
let candleSeries = null;
let currentSymbol = "BTCUSD";
let chartRequestId = 0;
let tickerSocket = null;
let chartSocket = null;
let tickerReconnectTimer = null;
let chartReconnectTimer = null;

const $ = (id) => document.getElementById(id);

const markets = [
  {
    symbol: "BTCUSD",
    price: "btcPrice",
    change: "btcChange",
    watchPrice: "watchBtcPrice",
    watchChange: "watchBtcChange"
  },
  {
    symbol: "ETHUSD",
    price: "ethPrice",
    change: "ethChange",
    watchPrice: "watchEthPrice",
    watchChange: "watchEthChange"
  },
  {
    symbol: "SOLUSD",
    price: "solPrice",
    change: "solChange",
    watchPrice: "watchSolPrice",
    watchChange: "watchSolChange"
  },
  {
    symbol: "XAUTUSD",
    price: "xautPrice",
    change: "xautChange",
    watchPrice: "watchXautPrice",
    watchChange: "watchXautChange"
  }
];

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

function setChange(id, value) {
  const el = $(id);
  if (!el) return;

  el.textContent = formatPercent(value);
  el.classList.toggle("positive", Number(value) > 0);
  el.classList.toggle("negative", Number(value) < 0);
}

function setStatus(message) {
  const el = $("chartStatus");
  if (el && !el.dataset.chartError) {
    el.textContent = message;
  }
}

function findTicker(rows, symbol) {
  return rows.find((row) => row.symbol === symbol);
}

function getTickerPrice(row) {
  if (!row) return NaN;

  // Prefer the latest traded/close price when available.
  const candidates = [
    row.close,
    row.last_price,
    row.mark_price
  ];

  for (const value of candidates) {
    const price = Number(value);
    if (Number.isFinite(price) && price > 0) return price;
  }

  return NaN;
}

function getTickerChange(row) {
  if (!row) return NaN;

  const candidates = [
    row.change_24h,
    row.mark_change_24h
  ];

  for (const value of candidates) {
    const change = Number(value);
    if (Number.isFinite(change)) return change;
  }

  return NaN;
}

function updateMarketCard(item, row) {
  if (!row) return;

  const price = getTickerPrice(row);
  const change = getTickerChange(row);

  if (Number.isFinite(price)) {
    if ($(item.price)) {
      $(item.price).textContent = formatPrice(price);
    }

    if ($(item.watchPrice)) {
      $(item.watchPrice).textContent = formatPrice(price);
    }
  }

  if (Number.isFinite(change)) {
    if ($(item.change)) {
      $(item.change).textContent =
        formatPercent(change) + " · 24H";

      $(item.change).classList.toggle("positive", change > 0);
      $(item.change).classList.toggle("negative", change < 0);
    }

    setChange(item.watchChange, change);
  }
}

async function fetchMarkets() {
  try {
    const response = await fetch(
      DELTA_API + "/v2/tickers",
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("Ticker API HTTP " + response.status);
    }

    const data = await response.json();

    if (!data.success || !Array.isArray(data.result)) {
      throw new Error("Unexpected Delta ticker response");
    }

    for (const item of markets) {
      updateMarketCard(
        item,
        findTicker(data.result, item.symbol)
      );
    }

    setStatus("Delta Exchange India · Public market data connected");
    console.log("Delta ticker data received:", data.result.length);
  } catch (error) {
    console.error("Delta ticker request failed:", error);
    setStatus("Delta market data unavailable · Retrying");
  }
}

function createChartIfNeeded() {
  const container = $("chart");

  if (!container) {
    console.warn('Chart container with id="chart" was not found.');
    return;
  }

  if (!window.LightweightCharts) {
    setStatus("Chart library not loaded");
    return;
  }

  if (chart) return;

  chart = LightweightCharts.createChart(container, {
    width: container.clientWidth || 600,
    height: 330,
    layout: {
      background: { color: "#0b0f0d" },
      textColor: "#b9c3bd"
    },
    grid: {
      vertLines: { color: "#202923" },
      horzLines: { color: "#202923" }
    },
    rightPriceScale: {
      borderColor: "#303a33"
    },
    timeScale: {
      borderColor: "#303a33",
      timeVisible: true,
      secondsVisible: false
    },
    localization: {
      priceFormatter: (price) => formatPrice(price)
    }
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: "#b6f36b",
    downColor: "#ff657a",
    borderUpColor: "#b6f36b",
    borderDownColor: "#ff657a",
    wickUpColor: "#b6f36b",
    wickDownColor: "#ff657a"
  });

  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      if (chart && container.clientWidth) {
        chart.applyOptions({
          width: container.clientWidth
        });
      }
    }).observe(container);
  }
}

async function loadChart(symbol) {
  currentSymbol = symbol;
const title = $("chartTitle");
 if (title) {
  const names = {
    BTCUSD: "BTC / USD",
    ETHUSD: "ETH / USD",
    SOLUSD: "SOL / USD",
    XAUTUSD: "XAUT / USD"
  };
  title.textContent = names[symbol] || symbol;
}
  const requestId = ++chartRequestId;

  if (chartSocket) {
    chartSocket.onclose = null;
    chartSocket.close();
    chartSocket = null;
  }

  createChartIfNeeded();

  if (!chart || !candleSeries) return;

  setStatus(symbol + " · Loading Delta candles...");

  try {
    const end = Math.floor(Date.now() / 1000);
    const start = end - 100 * 60 * 60;

    const params = new URLSearchParams({
      resolution: "1h",
      symbol,
      start: String(start),
      end: String(end)
    });

    const response = await fetch(
      DELTA_API + "/v2/history/candles?" + params.toString(),
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("Candle API HTTP " + response.status);
    }

    const data = await response.json();

    if (!data.success || !Array.isArray(data.result)) {
      throw new Error("Unexpected Delta candle response");
    }

    if (requestId !== chartRequestId) return;

    const candles = data.result
      .map((c) => ({
        time: Number(c.time),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close)
      }))
      .filter((c) =>
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close)
      )
      .sort((a, b) => a.time - b.time)
      .filter((c, i, arr) =>
        i === 0 || c.time !== arr[i - 1].time
      );

    candleSeries.setData(candles);
    chart.timeScale().fitContent();

    setStatus(
      symbol + " · Delta Exchange India · Live updates starting"
    );

    connectLiveChart(symbol);
  } catch (error) {
    console.error("Delta candle request failed:", error);
    setStatus(symbol + " · Could not load Delta candles");
  }
}

function connectLivePrices() {
  if (tickerReconnectTimer) {
    clearTimeout(tickerReconnectTimer);
    tickerReconnectTimer = null;
  }

  if (tickerSocket) {
    tickerSocket.onclose = null;
    tickerSocket.close();
  }

  tickerSocket = new WebSocket(DELTA_WS);

  tickerSocket.onopen = () => {
    tickerSocket.send(JSON.stringify({
      type: "subscribe",
      payload: {
        channels: [{
          name: "ticker",
          symbols: markets.map((m) => m.symbol)
        }]
      }
    }));

    console.log("Delta ticker WebSocket connected");
  };

  tickerSocket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);

      // Delta ticker updates can carry one or more entries in "d".
      const rows = Array.isArray(message.d)
        ? message.d
        : message.symbol
          ? [message]
          : [];

      for (const row of rows) {
        const symbol = row.s || row.symbol;
        const item = markets.find((m) => m.symbol === symbol);

        if (item) updateMarketCard(item, row);
      }
    } catch (error) {
      console.error("Delta ticker message error:", error);
    }
  };

  tickerSocket.onerror = () => {
    console.warn("Delta ticker WebSocket error");
  };

  tickerSocket.onclose = () => {
    tickerReconnectTimer = setTimeout(connectLivePrices, 5000);
  };
}

function connectLiveChart(symbol) {
  if (chartReconnectTimer) {
    clearTimeout(chartReconnectTimer);
    chartReconnectTimer = null;
  }

  if (chartSocket) {
    chartSocket.onclose = null;
    chartSocket.close();
  }

  chartSocket = new WebSocket(DELTA_WS);

  chartSocket.onopen = () => {
    chartSocket.send(JSON.stringify({
      type: "subscribe",
      payload: {
        channels: [{
          name: "candlestick_1h",
          symbols: [symbol]
        }]
      }
    }));

    console.log("Delta live candles subscribed:", symbol);
  };

  chartSocket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);

      if (message.type !== "candlestick_1h") return;

      const candleSymbol = message.sy || message.symbol;
      if (candleSymbol !== currentSymbol || symbol !== currentSymbol) {
        return;
      }

      const candle = {
        time: Math.floor(Number(message.ts) / 1000000),
        open: Number(message.o),
        high: Number(message.h),
        low: Number(message.l),
        close: Number(message.c)
      };

      if (
        !Number.isFinite(candle.time) ||
        !Number.isFinite(candle.open) ||
        !Number.isFinite(candle.high) ||
        !Number.isFinite(candle.low) ||
        !Number.isFinite(candle.close)
      ) {
        return;
      }

      candleSeries.update(candle);
      setStatus(
        symbol + " · Delta live candle · " +
        formatPrice(candle.close)
      );
    } catch (error) {
      console.error("Delta live candle error:", error);
    }
  };

  chartSocket.onerror = () => {
    console.warn("Delta chart WebSocket error");
  };

  chartSocket.onclose = () => {
    chartReconnectTimer = setTimeout(() => {
      if (symbol === currentSymbol) connectLiveChart(symbol);
    }, 5000);
  };
}

function initApp() {
  fetchMarkets();
  connectLivePrices();
  loadChart("BTCUSD");

  window.setInterval(fetchMarkets, 30000);

  document.querySelectorAll("[data-symbol]").forEach((button) => {
    button.addEventListener("click", () => {
      const symbol = button.dataset.symbol;
      if (symbol) loadChart(symbol);
    });
  });

  document.querySelectorAll("[data-chart-symbol]").forEach((button) => {
    button.addEventListener("click", () => {
      const symbol = button.dataset.chartSymbol;
      if (symbol) loadChart(symbol);
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
