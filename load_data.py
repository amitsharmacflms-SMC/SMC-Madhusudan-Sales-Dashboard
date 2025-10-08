# load_data.py
import pandas as pd
from sqlalchemy import text
from database import get_engine
import os

# -------------------------------------------------------------------
# ✅ File paths
# -------------------------------------------------------------------
product_csv = r"C:\Users\amit2\OneDrive\Desktop\DESKTOP\NEW DATA\usb data\dashboard_app\data\product.csv"
sku_csv = r"C:\Users\amit2\OneDrive\Desktop\DESKTOP\NEW DATA\usb data\dashboard_app\data\sku.csv"

engine = get_engine()

def clean_dataframe(df):
    """Normalize column names and parse dates."""
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    for col in df.columns:
        if "date" in col:
            df[col] = pd.to_datetime(df[col], errors="coerce")
    return df

def recreate_table(df, table_name):
    """Drop table, upload new data, and assign primary key."""
    if "id" not in df.columns:
        df.insert(0, "id", range(1, len(df) + 1))

    with engine.connect() as conn:
        print(f"\n🗑️ Dropping old '{table_name}' table (if exists)...")
        conn.execute(text(f"DROP TABLE IF EXISTS {table_name} CASCADE;"))
        conn.commit()

        print(f"⬆️ Uploading {len(df)} rows to '{table_name}'...")
        df.to_sql(table_name, con=engine, if_exists="replace", index=False)

        print(f"🔑 Setting 'id' as PRIMARY KEY...")
        conn.execute(text(f"ALTER TABLE {table_name} ADD PRIMARY KEY (id);"))
        conn.commit()
        print(f"✅ Table '{table_name}' rebuilt successfully!")

def upload_all():
    """Upload both CSVs."""
    files = {"product": product_csv, "sku": sku_csv}
    for name, path in files.items():
        if os.path.exists(path):
            print(f"📦 Loading data for {name}...")
            df = pd.read_csv(path)
            df = clean_dataframe(df)
            recreate_table(df, name)
        else:
            print(f"⚠️ File not found: {path}")

    print("\n🎉 All tables recreated successfully with primary keys!")

if __name__ == "__main__":
    upload_all()
