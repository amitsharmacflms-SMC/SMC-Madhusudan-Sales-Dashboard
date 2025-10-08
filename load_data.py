# load_data.py
import pandas as pd
from database import get_engine
import os

# ---------------------------------------------------------------------
# ✅ FULL CSV PATHS (from your local machine)
# ---------------------------------------------------------------------
product_csv = r"C:\Users\amit2\OneDrive\Desktop\DESKTOP\NEW DATA\usb data\dashboard_app\data\product.csv"
sku_csv = r"C:\Users\amit2\OneDrive\Desktop\DESKTOP\NEW DATA\usb data\dashboard_app\data\sku.csv"
# ---------------------------------------------------------------------

engine = get_engine()

def clean_dataframe(df):
    """Standardize column names and convert date columns."""
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    for col in df.columns:
        if "date" in col:
            df[col] = pd.to_datetime(df[col], errors="coerce")
    return df

def upload_table(csv_path, table_name):
    """Upload a single CSV file to the database."""
    if not os.path.exists(csv_path):
        print(f"⚠️ File not found: {csv_path}")
        return
    
    print(f"📦 Loading file: {csv_path}")
    df = pd.read_csv(csv_path)
    df = clean_dataframe(df)
    print(f"🧹 Cleaned columns: {list(df.columns)}")

    # Replace the table contents
    df.to_sql(table_name, con=engine, if_exists="replace", index=False)
    print(f"✅ Uploaded {len(df)} rows to '{table_name}' table.\n")

def main():
    try:
        upload_table(product_csv, "product")
        upload_table(sku_csv, "sku")
        print("🎉 All data successfully uploaded to Render PostgreSQL database!")
    except Exception as e:
        print(f"❌ Upload failed due to: {e}")

if __name__ == "__main__":
    main()
