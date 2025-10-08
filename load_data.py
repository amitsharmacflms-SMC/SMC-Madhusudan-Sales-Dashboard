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

# -------------------------------------------------------------------
# ✅ Utility: Clean DataFrame
# -------------------------------------------------------------------
def clean_dataframe(df):
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    for col in df.columns:
        if "date" in col:
            df[col] = pd.to_datetime(df[col], errors="coerce")
    return df

# -------------------------------------------------------------------
# ✅ Upload CSV to PostgreSQL
# -------------------------------------------------------------------
def upload_table(csv_path, table_name):
    if not os.path.exists(csv_path):
        print(f"⚠️ File not found: {csv_path}")
        return

    print(f"\n📦 Loading file: {csv_path}")
    df = pd.read_csv(csv_path)
    df = clean_dataframe(df)

    # Add primary key if missing
    if "id" not in df.columns:
        df.insert(0, "id", range(1, len(df) + 1))

    with engine.connect() as conn:
        # Drop the table first (if it exists)
        print(f"🗑️ Dropping existing table (if any): {table_name}")
        conn.execute(text(f"DROP TABLE IF EXISTS {table_name} CASCADE;"))
        conn.commit()

        # Upload fresh data
        print(f"⬆️ Uploading {len(df)} rows to '{table_name}'...")
        df.to_sql(table_name, con=engine, if_exists="replace", index=False)

        # Add primary key constraint
        print(f"🔑 Adding primary key to '{table_name}'...")
        conn.execute(text(f"ALTER TABLE {table_name} ADD PRIMARY KEY (id);"))
        conn.commit()

    print(f"✅ Table '{table_name}' recreated with primary key and data uploaded successfully.")

# -------------------------------------------------------------------
# ✅ Main entry
# -------------------------------------------------------------------
def main():
    try:
        upload_table(product_csv, "product")
        upload_table(sku_csv, "sku")
        print("\n🎉 All tables updated successfully on Render DB with primary keys!")
    except Exception as e:
        print(f"\n❌ Error: {e}")

if __name__ == "__main__":
    main()
