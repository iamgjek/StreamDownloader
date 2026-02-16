import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# 支援環境變數 DATABASE_URL
# Render PostgreSQL 格式：postgres://user:pass@host/dbname（會自動修正為 postgresql://）
# 本機開發預設使用 SQLite：sqlite:///./users.db
SQLALCHEMY_DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./users.db")

# Render 提供的 PostgreSQL URL 以 postgres:// 開頭，SQLAlchemy 2.x 需要 postgresql://
if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

_connect_args: dict = {}
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    # SQLite 專用：允許跨執行緒存取；同時確保父目錄存在
    _connect_args["check_same_thread"] = False
    _db_path_str = SQLALCHEMY_DATABASE_URL.replace("sqlite:///", "", 1)
    _db_path = Path(_db_path_str).resolve()
    _db_path.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args=_connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

IS_SQLITE = SQLALCHEMY_DATABASE_URL.startswith("sqlite")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
