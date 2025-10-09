import os
from datetime import datetime
import pandas as pd
from flask import Flask, render_template, request, redirect, url_for, session, flash, jsonify
from sqlalchemy import text
from database import get_engine

app = Flask(__name__)
app.secret_key = "supersecretkey"  # Replace with secure one for production


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
# DASHBOARD PAGE
# -----------------------
@app.route("/dashboard", methods=["GET"])
def dashboard():
    """Render main dashboard"""
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template("dashboard.html", current_year=datetime.utcnow().year)


# -----------------------
# API: FETCH DATA
# -----------------------
@app.route("/get_data/<view_type>")
def get_data(view_type):
    """Return Product or SKU data from Render DB"""
    if "user" not in session:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        engine = get_engine()

        if view_type not in ["product", "sku"]:
            return jsonify({"error": "Invalid table name"}), 400

        query = text(f"SELECT * FROM {view_type}")
        df = pd.read_sql(query, con=engine).fillna("")

        # ✅ Convert any date-like column names to string (no dropping)
        for col in df.columns:
            if "date" in col.lower() or "month" in col.lower():
                df[col] = df[col].astype(str)

        df = df.round(2)  # Make numbers readable

        return jsonify(df.to_dict(orient="records"))

    except Exception as e:
        print("❌ Error loading data:", e)
        return jsonify({"error": str(e)}), 500


# -----------------------
# HEALTH CHECK
# -----------------------
@app.route("/health")
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


# -----------------------
# MAIN ENTRY
# -----------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print("🚀 Starting Flask app on port", port)
    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print("✅ Database connection successful!")
    except Exception as e:
        print("❌ Database connection failed:", e)
    app.run(host="0.0.0.0", port=port, debug=True)
