import os
from datetime import datetime
import pandas as pd
from flask import (
    Flask, render_template, request,
    redirect, url_for, session, flash, jsonify
)
from sqlalchemy import text
from database import get_engine

app = Flask(__name__)
app.secret_key = "supersecretkey"  # keep secure later


# -------------------------------
# LOGIN PAGE
# -------------------------------
@app.route("/", methods=["GET", "POST"])
@app.route("/login", methods=["GET", "POST"])
def login():
    """Enhanced login with fade transition + message feedback"""
    message = None
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")

        if username == "admin" and password == "smc123":
            session["user"] = username
            flash("Login successful! Redirecting...", "success")
            return redirect(url_for("dashboard", status="success"))
        else:
            flash("Invalid Username or Password.", "danger")

    # Retrieve last flashed message
    messages = list(session.get('_flashes', []))
    message = messages[-1][1] if messages else None
    session.pop('_flashes', None)

    return render_template("login.html", message=message, current_year=datetime.utcnow().year)


# -------------------------------
# LOGOUT
# -------------------------------
@app.route("/logout", methods=["GET", "POST"])
def logout():
    """Logout and clear session"""
    session.clear()
    flash("You have been logged out successfully.", "success")
    return redirect(url_for("login"))


# -------------------------------
# DASHBOARD
# -------------------------------
@app.route("/dashboard")
def dashboard():
    """Main dashboard page"""
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template("dashboard.html", current_year=datetime.utcnow().year)


# -------------------------------
# GET DATA API (PRODUCT / SKU)
# -------------------------------
@app.route("/get_data/<view_type>")
def get_data(view_type):
    """Return product or SKU data with normalized lowercase column names"""
    if "user" not in session:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        engine = get_engine()

        if view_type not in ["product", "sku"]:
            return jsonify({"error": "Invalid table name"}), 400

        query = text(f"SELECT * FROM {view_type}")
        df = pd.read_sql(query, con=engine).fillna(0)

        # Normalize column names
        df.columns = [c.strip().lower() for c in df.columns]

        # Round numeric columns
        for col in df.columns:
            if pd.api.types.is_numeric_dtype(df[col]):
                df[col] = df[col].astype(float).round(0).astype(int)

        return jsonify(df.to_dict(orient="records"))

    except Exception as e:
        print("❌ Error loading data:", e)
        return jsonify({"error": str(e)}), 500


# -------------------------------
# HEALTH CHECK
# -------------------------------
@app.route("/health")
def health():
    """Simple uptime check"""
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


# -------------------------------
# MAIN
# -------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 Starting Flask on port {port}")
    app.run(host="0.0.0.0", port=port, debug=True)
