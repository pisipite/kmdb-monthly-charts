"""Generate a compact monthly entity-count snapshot from the public KMDB Parquet file."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import duckdb


PARQUET_URL = (
    "https://huggingface.co/datasets/K-Monitor/kmdb_base/resolve/"
    "refs%2Fconvert%2Fparquet/default/train/0000.parquet"
)
OUTPUT = Path(__file__).resolve().parents[1] / "public" / "monthly-counts.json"
ENTITY_COLUMNS = ("institutions", "files", "persons", "places", "others")


def main() -> None:
    connection = duckdb.connect()
    connection.execute("INSTALL httpfs; LOAD httpfs;")

    union_parts = [
        """
        SELECT
          'newspaper' AS entity_type,
          lower(trim(newspaper)) AS entity_key,
          strftime(try_cast(pub_time AS TIMESTAMP), '%Y-%m') AS month,
          count(*)::INTEGER AS article_count
        FROM source
        WHERE newspaper IS NOT NULL AND trim(newspaper) <> ''
        GROUP BY 1, 2, 3
        """
    ]

    for column in ENTITY_COLUMNS:
        union_parts.append(
            f"""
            SELECT
              '{column}' AS entity_type,
              entity_key,
              strftime(try_cast(pub_time AS TIMESTAMP), '%Y-%m') AS month,
              count(*)::INTEGER AS article_count
            FROM source,
            UNNEST(list_distinct(list_transform({column}, item -> lower(trim(item)))))
              AS entity(entity_key)
            WHERE entity_key IS NOT NULL AND entity_key <> ''
            GROUP BY 1, 2, 3
            """
        )

    query = f"""
        WITH source AS (
          SELECT pub_time, newspaper, institutions, files, persons, places, others
          FROM read_parquet('{PARQUET_URL}')
          WHERE try_cast(pub_time AS TIMESTAMP) IS NOT NULL
        )
        {" UNION ALL ".join(union_parts)}
        ORDER BY entity_type, entity_key, month
    """

    rows = connection.execute(query).fetchall()
    entities: dict[str, dict[str, list[list[str | int]]]] = {}
    for entity_type, entity_key, month, article_count in rows:
        entities.setdefault(entity_type, {}).setdefault(entity_key, []).append(
            [month, article_count]
        )

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": PARQUET_URL,
        "entities": entities,
    }
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": os.fspath(OUTPUT),
                "bytes": OUTPUT.stat().st_size,
                "entityTypes": {key: len(value) for key, value in entities.items()},
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
