# app.py
import os
from flask import Flask, render_template, request, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
import pandas as pd
from sqlalchemy import text
from datetime import datetime
from database import get_engine

app = Flask(__name__)
app.secret_key = "smc_dashboard_secret"

# Database engine
engine = get_engine()

# -----------------------------------------------------
# Helper functions
# -----------------------------------------------------
def get_dataframe(table_name):
    """Fetch a table from PostgreSQL into a Pandas DataFrame."""
    try:
        query = text(f"SELECT * FROM {table_name}")
        df = pd.read_sql(query, con=engine)
        if not df.empty:
            df.columns = [c.upper() for c in df.columns]
            # Handle ORDER_DATE if exists
            if "ORDER_DATE" in df.columns:
                df["ORDER_DATE"] = pd.to_datetime(df["ORDER_DATE"], errors="coerce")
                df["MONTH"] = df["ORDER_DATE"].dt.strftime("%b-%Y")
                df["QUARTER"] = df["ORDER_DATE"].dt.to_period("Q").astype(str)
                df["YEAR"] = df["ORDER_DATE"].dt.year
        return df
    except Exception as e:
        print(f"⚠️ Error reading {table_name}: {e}")
        return pd.DataFrame()

def get_all_periods(df):
    """Return all month/quarter options for filter dropdown."""
    if df.empty:
        return []
    months = df["MONTH"].dropna().unique().tolist() if "MONTH" in df else []
    quarters = df["QUARTER"].dropna().unique().tolist() if "QUARTER" in df else []
    combined = sorted(set(months + quarters))
    return combined

def filter_dataframe(df, period):
    """Filter dataframe by selected month/quarter."""
    if df.empty or not period:
        return df
    if "MONTH" in df.columns and period in df["MONTH"].values:
        return df[df["MONTH"] == period]
    elif "QUARTER" in df.columns and period in df["QUARTER"].values:
        return df[df["QUARTER"] == period]
    return df

def compare_two_periods(df, p1, p2):
    """Add a comparison column between two selected periods."""
    if df.empty or not p1 or not p2:
        return df, None

    df1 = filter_dataframe(df, p1)
    df2 = filter_dataframe(df, p2)

    if df1.empty or df2.empty:
        return df, None

    # Compare counts per PRODUCT or SKU depending on dataset
    key_col = "PRODUCT"
    if "SKU" in df.columns:
        key_col = "SKU"

    comp = (
        df1.groupby(key_col).size().rename("PERIOD_1")
        .to_frame().join(
            df2.groupby(key_col).size().rename("PERIOD_2"), how="outer"
        ).fillna(0)
    )
    comp["COMPARISON"] = comp["PERIOD_2"] - comp["PERIOD_1"]

    return comp.reset_index(), f"{p2} vs {p1}"

# -----------------------------------------------------
# Routes
# -----------------------------------------------------
@app.route("/")
def home():
    """Show login page first."""
    return redirect(url_for("login"))

from datetime import datetime

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form["username"]
        password = request.form["password"]
        if username == "admin" and password == "admin123":
            session["user"] = username
            return redirect(url_for("dashboard"))
        else:
            return render_template("login.html", error="Invalid credentials.", current_year=datetime.utcnow().year)

    return render_template("login.html", current_year=datetime.utcnow().year)

@app.route("/dashboard", methods=["GET", "POST"])
def dashboard():
    if "user" not in session:
        return redirect(url_for("login"))

    # Load both tables
    tab = request.args.get("tab", "product")
    df = get_dataframe(tab)

    all_periods = get_all_periods(df)

    selected_period = request.args.get("period")
    compare1 = request.args.get("compare1")
    compare2 = request.args.get("compare2")

    if compare1 and compare2:
        df, compare_label = compare_two_periods(df, compare1, compare2)
    else:
        df = filter_dataframe(df, selected_period)
        compare_label = None

    data = df.to_dict(orient="records")

    return render_template(
        "dashboard.html",
        active_tab=tab,
        data=data,
        periods=all_periods,
        selected_period=selected_period,
        compare1=compare1,
        compare2=compare2,
        compare_label=compare_label
    )

@app.route("/logout")
def logout():
    session.pop("user", None)
    return redirect(url_for("login"))

# -----------------------------------------------------
# Run app
# -----------------------------------------------------
if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
