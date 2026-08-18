"""Environment configuration for the pipeline.

Mirrors the documented variables in `.env.example`. Parsed once, at startup, and
failing loudly: a pipeline that starts with a wrong bucket name and discovers it
after extracting 20,000 rows wastes the run and leaves the audit trail confusing.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

SCHEMA_VERSION = "1.0.0"
"""Version of the raw Parquet layout. Recorded in every manifest.

Bump this when a column is added, removed or retyped, so a run's manifest says
which shape its files actually have rather than leaving a reader to guess.
"""

PIPELINE_VERSION = "0.1.0"


class ConfigError(RuntimeError):
    """Raised when the environment cannot produce a usable configuration."""


def _require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigError(
            f"{name} is required. Copy .env.example to .env, or pass it into the container."
        )
    return value


def _optional(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or default


@dataclass(frozen=True)
class PostgresConfig:
    host: str
    port: int
    database: str
    user: str
    password: str

    @property
    def sqlalchemy_url(self) -> str:
        # psycopg3 driver. Credentials are assembled here and nowhere else, so no
        # other module has a reason to hold the password.
        return (
            f"postgresql+psycopg://{self.user}:{self.password}"
            f"@{self.host}:{self.port}/{self.database}"
        )


@dataclass(frozen=True)
class LakeConfig:
    endpoint: str
    access_key: str
    secret_key: str
    region: str
    bucket: str
    raw_prefix: str


@dataclass(frozen=True)
class WarehouseConfig:
    path: Path

    @property
    def temp_path(self) -> Path:
        """Where a run builds before publishing.

        A sibling of the published file, so the final move is a rename within one
        filesystem and therefore atomic. Building in /tmp and copying across a
        volume boundary would not be.
        """
        return self.path.with_suffix(self.path.suffix + ".tmp")


@dataclass(frozen=True)
class Config:
    postgres: PostgresConfig
    lake: LakeConfig
    warehouse: WarehouseConfig


def load_config() -> Config:
    return Config(
        postgres=PostgresConfig(
            host=_optional("POSTGRES_HOST", "postgres"),
            port=int(_optional("POSTGRES_PORT", "5432")),
            database=_require("POSTGRES_DB"),
            user=_require("POSTGRES_USER"),
            password=_require("POSTGRES_PASSWORD"),
        ),
        lake=LakeConfig(
            endpoint=_optional("MINIO_ENDPOINT", "http://minio:9000"),
            access_key=_require("MINIO_ROOT_USER"),
            secret_key=_require("MINIO_ROOT_PASSWORD"),
            region=_optional("MINIO_REGION", "us-east-1"),
            bucket=_optional("LAKE_BUCKET", "sales-lake"),
            raw_prefix=_optional("LAKE_RAW_PREFIX", "raw").strip("/"),
        ),
        warehouse=WarehouseConfig(
            path=Path(_optional("WAREHOUSE_PATH", "/warehouse/sales.duckdb")),
        ),
    )
