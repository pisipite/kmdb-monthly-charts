"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type EntityColumn =
  | "newspaper"
  | "institutions"
  | "files"
  | "persons"
  | "places"
  | "others";

type EntityConfig = { column: EntityColumn; name: string; title: string };
type MonthValue = { month: string; count: number };
type MonthlySnapshot = {
  entities: Partial<Record<EntityColumn, Record<string, [string, number][]>>>;
};

const PARQUET_BASE =
  "https://huggingface.co/datasets/K-Monitor/kmdb_base/resolve/refs%2Fconvert%2Fparquet/default/train/0000.parquet";

const TYPE_ALIASES: Record<string, EntityColumn> = {
  lap: "newspaper",
  newspaper: "newspaper",
  intezmeny: "institutions",
  institution: "institutions",
  institutions: "institutions",
  akta: "files",
  file: "files",
  files: "files",
  szemely: "persons",
  person: "persons",
  persons: "persons",
  hely: "places",
  place: "places",
  places: "places",
  egyeb: "others",
  other: "others",
  others: "others",
};

const SEARCH_FIELDS: Record<EntityColumn, string> = {
  newspaper: "news_newspapers",
  institutions: "news_institutions",
  files: "news_files",
  persons: "news_persons",
  places: "news_places",
  others: "news_others",
};

function normalizeType(value: string | null): EntityColumn {
  const key = (value || "newspaper")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return TYPE_ALIASES[key] || "newspaper";
}

function readConfig(): EntityConfig {
  const params = new URLSearchParams(window.location.search);
  const name = (params.get("name") || "444").trim();
  return {
    column: normalizeType(params.get("type")),
    name,
    title: (params.get("title") || `${name} – kapcsolódó cikkek havonta`).trim(),
  };
}

function escapeSql(value: string): string {
  return value.replaceAll("'", "''");
}

function fillMissingMonths(rows: MonthValue[]): MonthValue[] {
  if (rows.length === 0) return [];
  const known = new Map(rows.map((row) => [row.month, row.count]));
  const [firstYear, firstMonth] = rows[0].month.split("-").map(Number);
  const [lastYear, lastMonth] = rows[rows.length - 1].month
    .split("-")
    .map(Number);
  const filled: MonthValue[] = [];
  let year = firstYear;
  let month = firstMonth;

  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    filled.push({ month: key, count: known.get(key) || 0 });
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return filled;
}

function formatMonth(value: string): string {
  return new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "long",
  }).format(new Date(`${value}-01T12:00:00Z`));
}

function openFilteredSearch(config: EntityConfig, monthValue: string): void {
  const [year, month] = monthValue.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const form = document.createElement("form");
  form.method = "post";
  form.action = "https://adatbazis.k-monitor.hu/kereses";
  form.target = "_blank";
  form.style.display = "none";

  const fields: Record<string, string> = {
    search_switch: "2",
    [SEARCH_FIELDS[config.column]]: config.name,
    from_date: `${monthValue}-01`,
    to_date: `${monthValue}-${String(lastDay).padStart(2, "0")}`,
    "cid_2[5]": "on",
    "cid_2[6]": "on",
    "cid_2[7]": "on",
    news_type_news_2: "on",
    news_type_database_2: "on",
    news_type_reported_2: "on",
    search_tags_type: "2",
    go: "Keresés",
  };

  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
  form.remove();
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<{ destroy: () => void } | null>(null);
  const hasPreviewRef = useRef(false);
  const [config, setConfig] = useState<EntityConfig | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">(
    "loading",
  );
  const [total, setTotal] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => setConfig(readConfig()), []);

  const renderChart = useCallback(
    async (values: MonthValue[]) => {
      if (!config || !canvasRef.current || values.length === 0) return;
      const chartModule = await import("chart.js/auto");
      const articleTotal = values.reduce((sum, value) => sum + value.count, 0);
      setTotal(articleTotal);
      chartRef.current?.destroy();
      const Chart = chartModule.default;
      chartRef.current = new Chart(canvasRef.current, {
        type: "bar",
        data: {
          labels: values.map((value) => value.month),
          datasets: [
            {
              data: values.map((value) => value.count),
              backgroundColor: "#287fb8",
              hoverBackgroundColor: "#165f91",
              borderWidth: 0,
              barPercentage: 0.84,
              categoryPercentage: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { intersect: false, mode: "index" },
          plugins: {
            legend: { display: false },
            tooltip: {
              displayColors: false,
              callbacks: {
                title: (items) => formatMonth(String(items[0].label)),
                label: (item) => `${item.formattedValue} cikk`,
                afterBody: () => ["Kattints a találatok megnyitásához"],
              },
            },
          },
          onHover: (_event, elements, chart) => {
            chart.canvas.style.cursor = elements.length > 0 ? "pointer" : "default";
          },
          onClick: (_event, elements) => {
            const index = elements[0]?.index;
            const monthValue = index === undefined ? undefined : values[index]?.month;
            if (monthValue) openFilteredSearch(config, monthValue);
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: {
                autoSkip: true,
                maxTicksLimit: 16,
                maxRotation: 48,
                minRotation: 48,
                callback: (_value, index) => values[index]?.month || "",
              },
            },
            y: {
              beginAtZero: true,
              grid: { color: "rgba(42, 53, 65, 0.12)" },
              ticks: { precision: 0 },
              title: { display: true, text: "Cikkek száma" },
            },
          },
        },
      });
      hasPreviewRef.current = true;
      setStatus("ready");
    },
    [config],
  );

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    hasPreviewRef.current = false;
    setStatus("loading");

    void fetch("/monthly-counts.json")
      .then((response) => {
        if (!response.ok) throw new Error("A gyors előnézet nem tölthető be.");
        return response.json() as Promise<MonthlySnapshot>;
      })
      .then((snapshot) => {
        if (cancelled || hasPreviewRef.current) return;
        const key = config.name.trim().toLowerCase();
        const rows = snapshot.entities[config.column]?.[key] || [];
        const values = fillMissingMonths(
          rows.map(([month, count]) => ({ month, count })),
        );
        if (values.length > 0) void renderChart(values);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [config, renderChart]);

  const loadData = useCallback(async () => {
    if (!config || !canvasRef.current) return;
    if (!hasPreviewRef.current) setStatus("loading");

    let worker: Worker | null = null;
    let connection: { close: () => Promise<void> } | null = null;
    let database: { terminate: () => Promise<void> } | null = null;

    try {
      const duckdb = await import("@duckdb/duckdb-wasm");
      const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
      if (!bundle.mainWorker) throw new Error("A lekérdezőmotor nem tölthető be.");

      const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], {
          type: "text/javascript",
        }),
      );
      worker = new Worker(workerUrl);
      URL.revokeObjectURL(workerUrl);

      const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
      database = db;
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      const conn = await db.connect();
      connection = conn;

      const escapedName = escapeSql(config.name);
      const predicate =
        config.column === "newspaper"
          ? `lower(newspaper) = lower('${escapedName}')`
          : `list_contains(list_transform(${config.column}, item -> lower(item)), lower('${escapedName}'))`;
      const result = await conn.query(`
        SELECT
          strftime(try_cast(pub_time AS TIMESTAMP), '%Y-%m') AS month,
          count(*)::INTEGER AS article_count
        FROM read_parquet('${PARQUET_BASE}')
        WHERE ${predicate}
          AND try_cast(pub_time AS TIMESTAMP) IS NOT NULL
        GROUP BY 1
        ORDER BY 1
      `);

      const rows = result.toArray().map((row) => ({
        month: String(row.month),
        count: Number(row.article_count),
      }));
      const values = fillMissingMonths(rows);
      if (values.length === 0) {
        chartRef.current?.destroy();
        chartRef.current = null;
        hasPreviewRef.current = false;
        setStatus("empty");
        return;
      }
      await renderChart(values);
    } catch (error) {
      console.error(error);
      if (!hasPreviewRef.current) setStatus("error");
    } finally {
      await connection?.close().catch(() => undefined);
      await database?.terminate().catch(() => undefined);
      worker?.terminate();
    }
  }, [config, attempt, renderChart]);

  useEffect(() => {
    void loadData();
    return () => chartRef.current?.destroy();
  }, [loadData]);

  return (
    <main className="chart-shell">
      <header className="chart-header">
        <h1>{config?.title || "Kapcsolódó cikkek havonta"}</h1>
        {status === "ready" && (
          <p aria-live="polite">{total.toLocaleString("hu-HU")} cikk</p>
        )}
      </header>

      <div className="chart-stage" aria-busy={status === "loading"}>
        {status === "loading" && (
          <div className="loading-state" role="status">
            <span className="spinner" aria-hidden="true" />
            Aktuális adatok betöltése…
          </div>
        )}
        {status === "empty" && (
          <div className="message-state" role="status">
            Ehhez az entitáshoz nem található dátummal rendelkező cikk.
          </div>
        )}
        {status === "error" && (
          <div className="message-state" role="alert">
            <span>Az adatok átmenetileg nem tölthetők be.</span>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              Újrapróbálom
            </button>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className={status === "ready" ? "chart-canvas is-visible" : "chart-canvas"}
          role="img"
          aria-label={config ? `${config.title}, havi oszlopdiagram` : "Havi oszlopdiagram"}
          aria-hidden={status !== "ready"}
        />
      </div>

      <footer>
        <span className="chart-help">Kattints egy oszlopra a havi találatokért.</span>
        Forrás:{" "}
        <a
          href="https://huggingface.co/datasets/K-Monitor/kmdb_base"
          target="_blank"
          rel="noreferrer"
        >
          K-Monitor Adatbázis (Huggingface dataset)
        </a>
      </footer>
    </main>
  );
}
