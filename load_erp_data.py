# load_erp_data.py
import pandas as pd
from sqlalchemy import text
from database import get_engine
import os

# -------------------------------------------------------------------
# ✅ File path for your ERP CSV
# -------------------------------------------------------------------
erp_csv = r"C:\Users\amit2\OneDrive\Desktop\DESKTOP\NEW DATA\usb data\dashboard_app\data\erpreport.csv"

# -------------------------------------------------------------------
# ✅ Database connection
# -------------------------------------------------------------------
engine = get_engine()

# -------------------------------------------------------------------
# ✅ Helper: Clean DataFrame
# -------------------------------------------------------------------
def clean_erp_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize column names and convert Invoice_Date to proper DATE type."""
    df.columns = [
        c.strip().lower()
        .replace(" ", "_")
        .replace("(", "_")
        .replace(")", "_")
        .replace("\\", "_")
        .replace("/", "_")
        .replace("__", "_")
        for c in df.columns
    ]

    # Standardize column mapping
    col_map = {
        "customer_": "customer_name",
        "customername": "customer_name",
        "item_": "item_name",
        "invoice_date": "invoice_date",
        "rate": "rate",
        "material_a": "material_amount",
        "material_amount": "material_amount",
        "bill_amour": "bill_amount",
        "bill_amount": "bill_amount",
        "total_tax_value_gst": "total_tax_value_gst",
        "total_tax_value__gst_": "total_tax_value_gst",
        "total_tax_gst": "total_tax_value_gst",
        "total_tax_valuegst": "total_tax_value_gst",
        "aqtyissued": "aqtyissued",
        "tcs_amount": "tcs_amount",
    }

    normalized_cols = []
    for c in df.columns:
        normalized_cols.append(col_map.get(c, c))
    df.columns = normalized_cols

    # Ensure all required columns exist
    required = [
        "state", "district", "category", "customer_name", "item_name",
        "invoice_date", "rate", "material_amount", "bill_amount",
        "total_tax_value_gst", "aqtyissued", "tcs_amount"
    ]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"❌ Missing required columns in CSV: {', '.join(missing)}")

    # Convert invoice_date
    try:
        df["invoice_date"] = pd.to_datetime(df["invoice_date"], format="%d-%m-%Y", errors="coerce").dt.date
    except Exception:
        print("⚠️ Date format mismatch, falling back to auto-detection.")
        df["invoice_date"] = pd.to_datetime(df["invoice_date"], errors="coerce").dt.date

    # Convert numeric columns
    numeric_cols = [
        "rate", "material_amount", "bill_amount",
        "total_tax_value_gst", "aqtyissued", "tcs_amount"
    ]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    return df


# -------------------------------------------------------------------
# ✅ Upload ERP data to DB
# -------------------------------------------------------------------
def upload_erp_data():
    """Reads erpreport.csv and recreates 'lighthouse_sales' table in DB."""
    if not os.path.exists(erp_csv):
        print(f"❌ ERP CSV not found at: {erp_csv}")
        return

    print(f"📂 Loading ERP CSV from: {erp_csv}")
    df = pd.read_csv(erp_csv)
    df = clean_erp_dataframe(df)

    if "id" not in df.columns:
        df.insert(0, "id", range(1, len(df) + 1))

    print(f"⬆️ Preparing to upload {len(df)} rows to 'lighthouse_sales'...")

    with engine.begin() as conn:
        db_name = conn.execute(text("SELECT current_database();")).scalar()
        db_host = conn.engine.url.host or "localhost"
        print(f"🔗 Connected to database: {db_name} (Host: {db_host})")

        # Drop & recreate
        conn.execute(text("DROP TABLE IF EXISTS lighthouse_sales CASCADE;"))
        df.to_sql("lighthouse_sales", con=engine, if_exists="replace", index=False)
        conn.execute(text("ALTER TABLE lighthouse_sales ADD PRIMARY KEY (id);"))
        conn.execute(text("ALTER TABLE lighthouse_sales ALTER COLUMN invoice_date TYPE DATE USING invoice_date::DATE;"))

        # Count rows
        count = conn.execute(text("SELECT COUNT(*) FROM lighthouse_sales")).scalar()
        print(f"✅ Upload complete: {count} rows in 'lighthouse_sales'.")

        # Sample record
        sample = conn.execute(text("SELECT * FROM lighthouse_sales LIMIT 1")).fetchone()
        if sample:
            print("🧾 Sample record:", dict(sample._mapping))
        else:
            print("⚠️ Table is empty after upload!")

    print("✅ 'lighthouse_sales' table successfully refreshed.\n")


# -------------------------------------------------------------------
# ✅ Run directly
# -------------------------------------------------------------------
if __name__ == "__main__":
    upload_erp_data()
