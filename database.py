# database.py
import os
from sqlalchemy import create_engine
from dotenv import load_dotenv

# ---------------------------------------------------------------------
# ✅ Load environment variables automatically
# ---------------------------------------------------------------------
load_dotenv()  # This reads .env when running locally

DATABASE_URL = os.getenv("DATABASE_URL")

# ---------------------------------------------------------------------
# ✅ Safety check
# ---------------------------------------------------------------------
if not DATABASE_URL:
    raise ValueError("❌ DATABASE_URL not found. Please set it in Render or in a local .env file.")

# Render sometimes uses 'postgres://' instead of 'postgresql://'
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# ---------------------------------------------------------------------
# ✅ Create SQLAlchemy engine
# ---------------------------------------------------------------------
engine = create_engine(DATABASE_URL, echo=False, pool_pre_ping=True)

def get_engine():
    return engine

print("✅ Database connection configured successfully.")
