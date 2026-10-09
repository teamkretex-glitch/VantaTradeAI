
"use strict";

const DELTA_API = "https://api.india.delta.exchange";
const DELTA_WS = "wss://public-socket.india.delta.exchange";
const CHART_RESOLUTION = "1h";

let chart = null;
let candleSeries = null;
let currentSymbol = "BTCUSD";
let chartRequestId = 0;
let tickerSocket = null;
let chartSocket = null;
let priceTimer = null;
let reconnectTimer = null;
let resizeObserver = null;

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

function getPrice(row) {
  if (!row) return NaN;

  for (const value of [
    row.close,
    row.last_price,
    row.mark_price,
    row.spot_price
  ]) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return NaN;
}

function getChange(row) {
  if (!row) return NaN;

  for (const value of [
    row.change_24h,
    row.mark_change_24h
  ]) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }

  return NaN;
}

function updateMarketCard(item, row) {
  if (!item || !row) return;

  const price = getPrice(row);
  const change = getChange(row);

  if (Number.isFinite(price)) {
    if ($(item.price)) {
      $(item.price).textContent = formatPrice(price);
    }

    if ($(item.watchPrice)) {
      $(item.watchPrice).textContent = formatPrice(price);
    }

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
  }
}

async function fetchMarkets() {
  try {
    const response = await fetch(DELTA_API + "/v2/tickers", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Ticker HTTP " + response.status);
    }

    const data = await response.json();

    if (!data.success || !Array.isArray(data.result)) {
      throw new Error("Unexpected ticker response");
    }

    for (const item of markets) {
      const row = data.result.find(
        (r) => r.symbol === item.symbol
      );

      if (row) {
        updateMarketCard(item, row);
      } else {
        console.warn("Ticker symbol not found:", item.symbol);
      }
    }

    if (!chartSocket || chartSocket.readyState !== WebSocket.OPEN) {
      setStatus("Delta Exchange India · Prices updated");
    }
  } catch (error) {
    console.error("Delta ticker error:", error);
    setStatus("Market feed unavailable · Retrying");
  }
}

function updateChartHeading(symbol) {
  const item = findMarket(symbol);
  const title = $("chartTitle");

  if (title) {
    title.textContent = item ? item.name : symbol;
  }

  document.querySelectorAll("[data-symbol], [data-chart-symbol]")
    .forEach((button) => {
      const buttonSymbol =
        button.dataset.symbol || button.dataset.chartSymbol;

      button.classList.toggle("active", buttonSymbol === symbol);
    });

  const livePrice = $("chartLivePrice");
  if (livePrice) livePrice.textContent = "--";
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
    height: Math.max(300, container.clientHeight || 360),

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
      scaleMargins: {
        top: 0.12,
        bottom: 0.12
      },
      mode: 0
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
      if (chart && container.clientWidth > 0) {
        chart.applyOptions({
          width: container.clientWidth
        });
      }
    });

    resizeObserver.observe(container);
  }
}

function normalizeTime(value) {
  if (typeof value === "string" && !/^\d+(\.\d+)?$/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : NaN;
  }

  let time = Number(value);
  if (!Number.isFinite(time)) return NaN;

  // Delta historical API timestamps are Unix seconds.
  // WebSocket microsecond timestamps are handled separately.
  if (time > 1e14) time = Math.floor(time / 1e6);
  else if (time > 1e11) time = Math.floor(time / 1000);

  return Math.floor(time);
}

function normalizeCandle(c) {
  const time = normalizeTime(c.time ?? c.t);

  const candle = {
    time,
    open: Number(c.open ?? c.o),
    high: Number(c.high ?? c.h),
    low: Number(c.low ?? c.l),
    close: Number(c.close ?? c.c)
  };

  if (
    !Number.isFinite(candle.time) ||
    !Number.isFinite(candle.open) ||
    !Number.isFinite(candle.high) ||
    !Number.isFinite(candle.low) ||
    !Number.isFinite(candle.close) ||
    candle.open <= 0 ||
    candle.high <= 0 ||
    candle.low <= 0 ||
    candle.close <= 0 ||
    candle.high < candle.low ||
    candle.high < candle.open ||
    candle.high < candle.close ||
    candle.low > candle.open ||
    candle.low > candle.close
  ) {
    return null;
  }

  return candle;
}

async function loadChart(symbol) {
  currentSymbol = symbol;
  const requestId = ++chartRequestId;

  updateChartHeading(symbol);
  createChart();

  if (!chart || !candleSeries) return;

  if (chartSocket) {
    chartSocket.onclose = null;
    chartSocket.close();
    chartSocket = null;
  }

  setStatus(symbol + " · Loading historical candles...");

  try {
    const end = Math.floor(Date.now() / 1000);
    const start = end - 7 * 24 * 60 * 60;

    const params = new URLSearchParams({
      resolution: CHART_RESOLUTION,
      symbol,
      start: String(start),
      end: String(end)
    });

    const response = await fetch(
      DELTA_API + "/v2/history/candles?" + params.toString(),
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("Candles HTTP " + response.status);
    }

    const data = await response.json();

    if (!data.success || !Array.isArray(data.result)) {
      throw new Error("Unexpected candle response");
    }

    if (requestId !== chartRequestId) return;

    const candles = data.result
      .map(normalizeCandle)
      .filter(Boolean)
      .sort((a, b) => a.time - b.time)
      .filter((c, i, arr) =>
        i === 0 || c.time !== arr[i - 1].time
      );

    console.log("Delta candles:", symbol, candles.length, candles.slice(-3));

    if (candles.length < 2) {
      setStatus(
        symbol + " · Not enough historical candles returned"
      );
      console.warn("Insufficient candles:", data.result);
      return;
    }

    const first = candles[0];
    const last = candles[candles.length - 1];

    if (first.time === last.time) {
      setStatus(symbol + " · Candle timestamps are not distinct");
      console.error("Bad candle timestamps:", candles);
      return;
    }

    candleSeries.setData(candles);
    console.log("Chart candle count:", candles.length);
    console.log("First candle:", candles[0]);
    console.log("Last candle:", candles[candles.length - 1]);
    console.log("Price range:", Math.min(...candles.map(c => c.low)), Math.max(...candles.map(c => c.high)));

    // Fit history once when a symbol is selected.
    // Do not call fitContent for every live update, because that
    // would repeatedly reset the user's zoom.
    chart.timeScale().fitContent();

    setStatus(
      symbol + " · Delta Exchange India · Historical candles loaded"
    );

    connectLiveChart(symbol);
  } catch (error) {
    console.error("Delta candle request failed:", error);
    setStatus(symbol + " · Could not load candles · See console");
  }
}

function connectLiveChart(symbol) {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (chartSocket) {
    chartSocket.onclose = null;
    chartSocket.close();
  }

  const socket = new WebSocket(DELTA_WS);
  chartSocket = socket;

  socket.onopen = () => {
    if (socket !== chartSocket) return;

    socket.send(JSON.stringify({
      type: "subscribe",
      payload: {
        channels: [{
          name: "candlestick_1h",
          symbols: [symbol]
        }]
      }
    }));

    console.log("Subscribed to Delta candles:", symbol);
    setStatus(symbol + " · Delta live candle feed connected");
  };

  socket.onmessage = (event) => {
    if (socket !== chartSocket || symbol !== currentSymbol) return;

    try {
      const message = JSON.parse(event.data);

      if (message.type !== "candlestick_1h") return;

      const messageSymbol = message.sy || message.symbol;
      if (messageSymbol !== symbol) return;

      const rawTime = Number(message.ts);

      const candle = normalizeCandle({
        time: rawTime > 1e14
          ? Math.floor(rawTime / 1e6)
          : normalizeTime(rawTime),
        open: message.o,
        high: message.h,
        low: message.l,
        close: message.c
      });

      if (!candle) {
        console.warn("Invalid live candle:", message);
        return;
      }

      candleSeries.update(candle);

      const item = findMarket(symbol);
      if (item) {
        const change = getChange(message);
        const price = candle.close;

        if ($("chartLivePrice")) {
          $("chartLivePrice").textContent = formatPrice(price);
        }

        setStatus(
          symbol + " · Live candle · " + formatPrice(price)
        );
      }
    } catch (error) {
      console.error("Live candle message error:", error);
    }
  };

  socket.onerror = (error) => {
    console.warn("Delta candle socket error:", error);
  };

  socket.onclose = () => {
    if (socket !== chartSocket) return;

    reconnectTimer = setTimeout(() => {
      if (symbol === currentSymbol) {
        connectLiveChart(symbol);
      }
    }, 5000);
  };
}

function initApp() {
  createChart();

  fetchMarkets();

  if (priceTimer) clearInterval(priceTimer);
  priceTimer = setInterval(fetchMarkets, 15000);

  document.querySelectorAll("[data-symbol], [data-chart-symbol]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const symbol =
          button.dataset.symbol || button.dataset.chartSymbol;

        if (symbol && findMarket(symbol)) {
          loadChart(symbol);
        }
      });
    });

  loadChart("BTCUSD");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp, { once: true });
} else {
  initApp();
}
