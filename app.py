import os
from datetime import datetime
import pandas as pd
from flask import Flask, render_template, request, redirect, url_for, session, flash, jsonify
from sqlalchemy import text
from database import get_engine

app = Flask(__name__)
app.secret_key = "supersecretkey"


@app.route("/", methods=["GET", "POST"])
@app.route("/login", methods=["GET", "POST"])
def login():
    """Simple login"""
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
    session.clear()
    return redirect(url_for("login"))


@app.route("/dashboard")
def dashboard():
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template("dashboard.html", current_year=datetime.utcnow().year)


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

        # Normalize column names to lowercase
        df.columns = [c.strip().lower() for c in df.columns]

        # Format numeric columns (0 decimals)
        for col in df.columns:
            if pd.api.types.is_numeric_dtype(df[col]):
                df[col] = df[col].astype(float).round(0).astype(int)

        return jsonify(df.to_dict(orient="records"))

    except Exception as e:
        print("❌ Error:", e)
        return jsonify({"error": str(e)}), 500


@app.route("/health")
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print("🚀 Starting Flask on port", port)
    app.run(host="0.0.0.0", port=port, debug=True)
