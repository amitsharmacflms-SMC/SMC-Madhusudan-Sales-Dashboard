import os
from datetime import datetime
import pandas as pd
from flask import Flask, render_template, request, redirect, url_for, session, flash
from sqlalchemy import text
from database import get_engine

app = Flask(__name__)
app.secret_key = "supersecretkey"  # Replace with a secure one later


# -----------------------
# LOGIN ROUTES
# -----------------------
@app.route("/", methods=["GET", "POST"])
@app.route("/login", methods=["GET", "POST"])
def login():
    """Simple login page"""
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")

        # For now, using hardcoded admin login (can later move to DB)
        if username == "admin" and password == "smc123":
            session["user"] = username
            return redirect(url_for("dashboard"))
        else:
            flash("Invalid username or password", "danger")

    return render_template("login.html")


@app.route("/logout", methods=["POST"])
def logout():
    """Logout user"""
    session.clear()
    return redirect(url_for("login"))


# -----------------------
# DASHBOARD ROUTE
# -----------------------
@app.route("/dashboard", methods=["GET"])
def dashboard():
    """Main dashboard showing product and SKU data with filters"""
    if "user" not in session:
        return redirect(url_for("login"))

    try:
        # Get DB connection
        engine = get_engine()

        # Load data from product table
        query = text("SELECT * FROM product")
        df = pd.read_sql(query, con=engine)
        df = df.fillna("")

        # --- Generate unique date/period options ---
        if "order_date" in df.columns:
            df["order_date"] = df["order_date"].astype(str)
            periods = sorted(df["order_date"].unique())
        else:
            periods = []

        # --- Get filters from user input ---
        selected_period = request.args.get("period", "")
        compare1 = request.args.get("compare1", "")
        compare2 = request.args.get("compare2", "")

        # --- Apply filter if selected ---
        filtered_df = df.copy()
        if selected_period:
            filtered_df = filtered_df[filtered_df["order_date"] == selected_period]

        # --- Generate comparison label ---
        compare_label = ""
        if compare1 and compare2:
            compare_label = f"Comparison: {compare1} vs {compare2}"

        # --- Prepare data for rendering ---
        data = filtered_df.to_dict(orient="records")

        return render_template(
            "dashboard.html",
            data=data,
            active_tab="product",
            periods=periods,
            selected_period=selected_period,
            compare1=compare1,
            compare2=compare2,
            compare_label=compare_label,
            current_year=datetime.utcnow().year,  # ✅ Fix for footer
        )

    except Exception as e:
        return f"<h3 style='color:red;'>⚠️ Dashboard error: {e}</h3>"


# -----------------------
# ADMIN / HEALTH CHECK
# -----------------------
@app.route("/health")
def health():
    """Render health check"""
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


# -----------------------
# MAIN ENTRY POINT
# -----------------------
if __name__ == "__main__":
    # For local testing only
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
