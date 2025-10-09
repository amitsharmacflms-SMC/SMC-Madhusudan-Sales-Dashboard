import os
from datetime import datetime
import pandas as pd
from flask import Flask, render_template, request, redirect, url_for, session, flash, jsonify
from sqlalchemy import text
from database import get_engine

app = Flask(__name__)
app.secret_key = "supersecretkey"  # Replace with a secure one in production


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

        # Temporary static admin login
        if username == "admin" and password == "smc123":
            session["user"] = username
            return redirect(url_for("dashboard"))
        else:
            flash("Invalid username or password", "danger")

    return render_template("login.html", current_year=datetime.utcnow().year)


@app.route("/logout", methods=["POST", "GET"])
def logout():
    """Logout user"""
    session.clear()
    return redirect(url_for("login"))


# -----------------------
# DASHBOARD PAGE (HTML)
# -----------------------
@app.route("/dashboard", methods=["GET"])
def dashboard():
    """Render the dashboard page"""
    if "user" not in session:
        return redirect(url_for("login"))

    return render_template(
        "dashboard.html",
        current_year=datetime.utcnow().year,
    )


# -----------------------
# API: FETCH DATA FROM DATABASE
# -----------------------
@app.route("/get_data/<view_type>")
def get_data(view_type):
    """Return product or SKU data as JSON for dynamic frontend loading"""
    if "user" not in session:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        engine = get_engine()

        if view_type not in ["product", "sku"]:
            return jsonify({"error": "Invalid table name"}), 400

        # Fetch all rows from the selected table
        query = text(f"SELECT * FROM {view_type}")
        df = pd.read_sql(query, con=engine).fillna("")

        # Keep only text/object and date columns
        keep_cols = [
            col for col in df.columns
            if df[col].dtype == "object" or "date" in col.lower()
        ]
        df = df[keep_cols]

        # Convert datetime columns to strings
        for col in df.columns:
            if "date" in col.lower():
                df[col] = pd.to_datetime(df[col], errors="coerce").dt.strftime("%Y-%m-%d")

        return jsonify(df.to_dict(orient="records"))

    except Exception as e:
        print("❌ Error loading data:", e)
        return jsonify({"error": str(e)}), 500


# -----------------------
# HEALTH CHECK
# -----------------------
@app.route("/health")
def health():
    """Simple health check"""
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


# -----------------------
# MAIN ENTRY
# -----------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
