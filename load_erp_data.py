# load_erp_data.py
import pandas as pd
from sqlalchemy import text
from database import get_engine
import os
from datetime import datetime, timezone
import io

# -------------------------------------------------------------------
# ✅ File path for your ERP CSV
# -------------------------------------------------------------------
erp_csv = r"C:\Users\amit2\OneDrive\Desktop\DESKTOP\NEW DATA\usb data\dashboard_app\data\erpreport.csv"

# -------------------------------------------------------------------
# ✅ Connect to database
# -------------------------------------------------------------------
engine = get_engine()

# -------------------------------------------------------------------
# ✅ Helper: Clean and prepare ERP data
# -------------------------------------------------------------------
def clean_erp_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize headers and ensure correct column names and types."""
    df.columns = [c.strip().lower().replace(" ", "_").replace("(", "_").replace(")", "_") for c in df.columns]

    # Expected columns in lowercase
    required = [
        "state", "party_name", "item_name", "invoice_date",
        "bill_number", "quantity_kg", "bill_amount", "quantity_cs"
    ]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"❌ Missing required columns in CSV: {', '.join(missing)}")

    # Parse Invoice_Date column
    try:
        df["invoice_date"] = pd.to_datetime(df["invoice_date"], format="%d-%m-%Y", errors="coerce")
    except Exception:
        df["invoice_date"] = pd.to_datetime(df["invoice_date"], errors="coerce")

    # Numeric conversions
    for col in ["quantity_kg", "bill_amount", "quantity_cs"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    # Add upload timestamp
    df["uploaded_at"] = datetime.now(timezone.utc)

    return df


# -------------------------------------------------------------------
# ✅ Upload using PostgreSQL COPY (fast)
# -------------------------------------------------------------------
def upload_via_copy(df, table_name):
    """Use PostgreSQL COPY FROM STDIN for high-speed upload."""
    print(f"🚀 Uploading {len(df)} rows to '{table_name}' via COPY (fast mode)...")

    conn = engine.raw_connection()
    try:
        cur = conn.cursor()
        buffer = io.StringIO()
        df.to_csv(buffer, index=False, header=True)
        buffer.seek(0)

        # Drop table if exists
        cur.execute(f"DROP TABLE IF EXISTS {table_name} CASCADE;")
        conn.commit()

        # Create a proper schema before upload
        create_table_sql = f"""
        CREATE TABLE {table_name} (
            id SERIAL PRIMARY KEY,
            state TEXT,
            party_name TEXT,
            item_name TEXT,
            invoice_date DATE,
            bill_number TEXT,
            quantity_kg NUMERIC,
            bill_amount NUMERIC,
            quantity_cs NUMERIC,
            uploaded_at TIMESTAMP
        );
        """
        cur.execute(create_table_sql)
        conn.commit()

        # Copy data
        buffer.seek(0)
        cur.copy_expert(f"COPY {table_name} (state, party_name, item_name, invoice_date, bill_number, quantity_kg, bill_amount, quantity_cs, uploaded_at) FROM STDIN WITH CSV HEADER", buffer)
        conn.commit()

        print(f"✅ Upload complete: {len(df)} rows written to '{table_name}'.")
    finally:
        conn.close()


# -------------------------------------------------------------------
# ✅ Main Upload Function
# -------------------------------------------------------------------
def upload_erp_data():
    """Clean CSV and upload to PostgreSQL."""
    if not os.path.exists(erp_csv):
        print(f"❌ ERP CSV not found: {erp_csv}")
        return

    print(f"📂 Loading ERP CSV from: {erp_csv}")
    df = pd.read_csv(erp_csv)
    df = clean_erp_dataframe(df)

    upload_via_copy(df, "lighthouse_sales")

    with engine.connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM lighthouse_sales")).scalar()
        row = conn.execute(text("SELECT * FROM lighthouse_sales LIMIT 1")).fetchone()

        print(f"✅ Final row count: {count}")
        print("🧾 Sample row:", dict(row._mapping) if row else "None")


# -------------------------------------------------------------------
# ✅ Script Entry Point
# -------------------------------------------------------------------
if __name__ == "__main__":
    print("✅ Database connection configured successfully.")
    upload_erp_data()
