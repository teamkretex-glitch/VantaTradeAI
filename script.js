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

let marketSocket = null;

function connectLivePrices() {
  if (marketSocket) {
    marketSocket.close();
  }

  const streams = [
    "btcusdt@ticker",
    "ethusdt@ticker",
    "solusdt@ticker"
  ].join("/");

  marketSocket = new WebSocket(
    "wss://stream.binance.com:9443/stream?streams=" + streams
  );

  marketSocket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      const data = message.data;

      const config = {
        BTCUSDT: {
          price: "btcPrice",
          change: "btcChange",
          watchPrice: "watchBtcPrice",
          watchChange: "watchBtcChange"
        },
        ETHUSDT: {
          price: "ethPrice",
          change: "ethChange",
          watchPrice: "watchEthPrice",
          watchChange: "watchEthChange"
        },
        SOLUSDT: {
          price: "solPrice",
          change: "solChange",
          watchPrice: "watchSolPrice",
          watchChange: "watchSolChange"
        }
      };

      const item = config[data.s];
      if (!item) return;

      const price = Number(data.c);
      const change = Number(data.P);

      if ($(item.price)) {
        $(item.price).textContent = formatPrice(price);
      }

      if ($(item.watchPrice)) {
        $(item.watchPrice).textContent = formatPrice(price);
      }

      if ($(item.change)) {
        $(item.change).textContent =
          formatPercent(change) + " · 24H";
        $(item.change).classList.toggle("positive", change > 0);
        $(item.change).classList.toggle("negative", change < 0);
      }

      setChange(item.watchChange, change);
    } catch (error) {
      console.error("Live price update failed:", error);
    }
  };

  marketSocket.onclose = () => {
    setTimeout(connectLivePrices, 5000);
  };

  marketSocket.onerror = () => {
    marketSocket.close();
  };
}

async function fetchMarkets() {
  try {
    const response = await fetch(
      "https://api.india.delta.exchange/v2/tickers",
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("Delta API HTTP " + response.status);
    }

    const result = await response.json();

    if (!result.success || !Array.isArray(result.result)) {
      throw new Error("Invalid Delta ticker response");
    }

    const rows = result.result;

    const config = [
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

    for (const item of config) {
      const market = rows.find(
        (row) => row.symbol === item.symbol
      );

      if (!market) {
        console.warn("Delta symbol unavailable:", item.symbol);
        continue;
      }

      const price = Number(
        market.mark_price ?? market.close
      );

      const change = Number(market.change_24h);

      if (!Number.isFinite(price)) {
        console.warn("Invalid price:", item.symbol, market);
        continue;
      }

      if ($(item.price)) {
        $(item.price).textContent = formatPrice(price);
      }

      if ($(item.watchPrice)) {
        $(item.watchPrice).textContent = formatPrice(price);
      }

      if (Number.isFinite(change)) {
        if ($(item.change)) {
          $(item.change).textContent =
            formatPercent(change) + " · 24H";

          $(item.change).classList.toggle(
            "positive",
            change > 0
          );

          $(item.change).classList.toggle(
            "negative",
            change < 0
          );
        }

        setChange(item.watchChange, change);
      }
    }

    const status = $("chartStatus");

    if (status && !status.dataset.chartError) {
      status.textContent =
        "Delta Exchange India connected · Refreshing every 30 seconds";
    }

  } catch (error) {
    console.error("Delta market prices failed:", error);

    const status = $("chartStatus");

    if (status && !status.dataset.chartError) {
      status.textContent =
        "Delta market feed unavailable · Retry later";
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

let chartSocket = null;

function connectLiveChart(symbol) {
  if (chartSocket) {
    chartSocket.close();
    chartSocket = null;
  }

  chartSocket = new WebSocket(
    "wss://stream.binance.com:9443/ws/" +
    symbol.toLowerCase() +
    "@kline_1h"
  );

  chartSocket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      const k = message.k;

      if (!k || !candleSeries || symbol !== currentSymbol) {
        return;
      }

      candleSeries.update({
        time: Math.floor(k.t / 1000),
        open: Number(k.o),
        high: Number(k.h),
        low: Number(k.l),
        close: Number(k.c)
      });

      const status = $("chartStatus");

      if (status && !status.dataset.chartError) {
        status.textContent =
          symbol.replace("USDT", "") +
          "/USDT · Live candle · Latest price: " +
          formatPrice(Number(k.c));
      }
    } catch (error) {
      console.error("Live chart update failed:", error);
    }
  };

  chartSocket.onerror = () => {
    console.error("Live chart WebSocket error");
  };
}

async function loadChart(symbol) {
  currentSymbol = symbol;
  const requestId = ++chartRequestId;
  
  connectLiveChart(symbol);
  
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
      "&interval=1h&limit=100";

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

candleSeries.priceScale().applyOptions({
  autoScale: true
});

chart.timeScale().applyOptions({
  rightOffset: 5,
  barSpacing: 8
});

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
  connectLivePrices();
  loadChart("BTCUSDT");

  window.setInterval(fetchMarkets, 30000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}


async function testDeltaMarketData() {
  const status = document.getElementById("chartStatus");

  try {
    const response = await fetch(
      "https://api.india.delta.exchange/v2/tickers"
    );

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    const result = await response.json();

    if (!result.success || !Array.isArray(result.result)) {
      throw new Error("Unexpected API response");
    }

    console.log("Delta API connected:", result.result.length, "tickers");
    console.log(
      "Available symbols:",
      result.result
        .filter(item =>
          ["BTCUSD", "ETHUSD", "SOLUSD", "XAUTUSD"].includes(item.symbol)
        )
        .map(item => ({
          symbol: item.symbol,
          price: item.mark_price,
          close: item.close
        }))
    );

    if (status) {
      status.textContent =
        "Delta public API connected · " +
        result.result.length +
        " tickers received";
    }
  } catch (error) {
    console.error("Delta market data error:", error);

    if (status) {
      status.textContent = "Delta API test failed · Check console";
    }
  }
}

testDeltaMarketData();
