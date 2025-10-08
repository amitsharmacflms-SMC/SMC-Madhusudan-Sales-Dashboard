# database.py
import os
from sqlalchemy import create_engine

# Use environment variable for database URL
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("❌ DATABASE_URL environment variable not found. Please set it in Render.")

# Ensure proper SQLAlchemy format
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL, echo=False)

def get_engine():
    """Return SQLAlchemy engine."""
    return engine
