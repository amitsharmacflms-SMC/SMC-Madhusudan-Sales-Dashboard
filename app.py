import os
import pandas as pd
import time
from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for, flash, session, abort
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

# -----------------------------------------------------------------------------
# Flask setup
# -----------------------------------------------------------------------------
app = Flask(__name__)
app.secret_key = "supersecretkey"

# -----------------------------------------------------------------------------
# PostgreSQL Configuration (Render)
# -----------------------------------------------------------------------------
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://dashboard_db_h0q1_user:RegcquXmPWdEXRFUxNSysH3FsMuQ5ozg@dpg-d3ilg7be5dus7398abg0-a.singapore-postgres.render.com/dashboard_db_h0q1"
)

# Ensure proper SQLAlchemy prefix
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

app.config["SQLALCHEMY_DATABASE_URI"] = DATABASE_URL
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)

# -----------------------------------------------------------------------------
# Database Models
# -----------------------------------------------------------------------------
class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(150), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False)
    state = db.Column(db.String(100))
    manager_name = db.Column(db.String(150))
    district = db.Column(db.String(150))

    def set_password(self, pwd):
        self.password_hash = generate_password_hash(pwd)

    def check_password(self, pwd):
        return check_password_hash(self.password_hash, pwd)


class Product(db.Model):
    __tablename__ = "product"
    id = db.Column(db.Integer, primary_key=True)
    state = db.Column(db.String(100))
    manager_name = db.Column(db.String(150))
    district = db.Column(db.String(150))
    party_name = db.Column(db.String(200))
    product = db.Column(db.String(200))
    order_date = db.Column(db.Date)
    value = db.Column(db.Float)


class SKU(db.Model):
    __tablename__ = "sku"
    id = db.Column(db.Integer, primary_key=True)
    state = db.Column(db.String(100))
    manager_name = db.Column(db.String(150))
    district = db.Column(db.String(150))
    party_name = db.Column(db.String(200))
    product = db.Column(db.String(200))
    sku = db.Column(db.String(200))
    order_date = db.Column(db.Date)
    value = db.Column(db.Float)

# -----------------------------------------------------------------------------
# Auto-create Database Tables + Admin
# -----------------------------------------------------------------------------
def initialize_database():
    """Creates tables, default admin, and optionally imports CSVs."""
    start = time.time()
    for attempt in range(20):  # Increased attempts, shorter sleep
        try:
            db.create_all()
            print("✅ Tables created or already exist.")

            # Create default admin if not exists
            if not User.query.filter_by(user_id="admin").first():
                admin = User(
                    user_id="admin",
                    role="Admin",
                    state="HQ",
                    manager_name="Amit",
                    district="Central"
                )
                admin.set_password("admin123")
                db.session.add(admin)
                db.session.commit()
                print("✅ Default admin created (admin / admin123)")

            # CSV import logic (optional, can comment out for faster deploy)
            def parse_date(v):
                try:
                    return pd.to_datetime(v).date()
                except Exception:
                    return None

            # 🚀 Optional: comment out this section if you want faster deploys
            if os.path.exists("data/product.csv") and Product.query.count() == 0:
                df = pd.read_csv("data/product.csv")
                for _, r in df.iterrows():
                    db.session.add(Product(
                        state=r.get("STATE"),
                        manager_name=r.get("MANAGER_NAME"),
                        district=r.get("DISTRICT"),
                        party_name=r.get("PARTY_NAME"),
                        product=r.get("PRODUCT"),
                        order_date=parse_date(r.get("ORDER_DATE")),
                        value=float(r.get("VALUE", 0)) if "VALUE" in r and not pd.isna(r["VALUE"]) else None
                    ))
                db.session.commit()
                print("✅ Product CSV imported.")

            if os.path.exists("data/sku.csv") and SKU.query.count() == 0:
                df = pd.read_csv("data/sku.csv")
                for _, r in df.iterrows():
                    db.session.add(SKU(
                        state=r.get("STATE"),
                        manager_name=r.get("MANAGER_NAME"),
                        district=r.get("DISTRICT"),
                        party_name=r.get("PARTY_NAME"),
                        product=r.get("PRODUCT"),
                        sku=r.get("SKU"),
                        order_date=parse_date(r.get("ORDER_DATE")),
                        value=float(r.get("VALUE", 0)) if "VALUE" in r and not pd.isna(r["VALUE"]) else None
                    ))
                db.session.commit()
                print("✅ SKU CSV imported.")

            print(f"✅ Database initialized successfully in {time.time() - start:.1f}s.")
            break

        except Exception as e:
            print(f"⏳ DB not ready (attempt {attempt + 1}/20). Retrying in 2s...")
            print(f"Error: {e}")
            time.sleep(2)

# -----------------------------------------------------------------------------
# Analytics helpers
# -----------------------------------------------------------------------------
def compute_quarterly_avg(df):
    if "order_date" not in df or "value" not in df:
        return None
    df = df.dropna(subset=["order_date", "value"])
    if df.empty:
        return None
    df["order_date"] = pd.to_datetime(df["order_date"])
    df["Quarter"] = df["order_date"].dt.to_period("Q")
    return df.groupby("Quarter")["value"].mean().reset_index(name="avg_value")

def compute_yoy_avg(df):
    if "order_date" not in df or "value" not in df:
        return None
    df = df.dropna(subset=["order_date", "value"])
    if df.empty:
        return None
    df["order_date"] = pd.to_datetime(df["order_date"])
    df["Year"] = df["order_date"].dt.year
    return df.groupby("Year")["value"].mean().reset_index(name="avg_value")

# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------
@app.route("/")
def home():
    if "user_id" in session:
        return redirect(url_for("dashboard"))
    return render_template("login.html")

@app.route("/login", methods=["POST"])
def login():
    u = User.query.filter_by(user_id=request.form["user_id"]).first()
    if u and u.check_password(request.form["password"]):
        session["user_id"] = u.user_id
        session["role"] = u.role
        flash(f"Welcome, {u.user_id}!", "success")
        return redirect(url_for("dashboard"))
    flash("Invalid credentials", "danger")
    return redirect(url_for("home"))

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("home"))

@app.route("/dashboard")
def dashboard():
    if "user_id" not in session:
        return redirect(url_for("home"))

    from sqlalchemy import select, text

    # ✅ Correct SQLAlchemy 2.x compatible query for Pandas
    with db.engine.connect() as connection:
        p_df = pd.read_sql(select(Product).compile(connection), connection)
        s_df = pd.read_sql(select(SKU).compile(connection), connection)

    # Compute summaries
    q_avg_p = compute_quarterly_avg(p_df)
    yoy_avg_p = compute_yoy_avg(p_df)
    q_avg_s = compute_quarterly_avg(s_df)
    yoy_avg_s = compute_yoy_avg(s_df)

    return render_template(
        "dashboard.html",
        role=session.get("role"),
        q_avg_p=q_avg_p.to_dict("records") if q_avg_p is not None else [],
        yoy_avg_p=yoy_avg_p.to_dict("records") if yoy_avg_p is not None else [],
        q_avg_s=q_avg_s.to_dict("records") if q_avg_s is not None else [],
        yoy_avg_s=yoy_avg_s.to_dict("records") if yoy_avg_s is not None else [],
    )
@app.route("/admin")
def admin_panel():
    if session.get("role") != "Admin":
        abort(403)
    users = User.query.order_by(User.user_id).all()
    return render_template("admin.html", users=users)

@app.route("/admin/create", methods=["POST"])
def admin_create_user():
    if session.get("role") != "Admin":
        abort(403)
    uid = request.form["user_id"].strip()
    pwd = request.form["password"].strip()
    role = request.form["role"]
    state = request.form.get("state", "")
    manager_name = request.form.get("manager_name", "")
    district = request.form.get("district", "")

    if not uid or not pwd:
        flash("User ID and Password required!", "danger")
        return redirect(url_for("admin_panel"))

    if User.query.filter_by(user_id=uid).first():
        flash("User already exists!", "danger")
        return redirect(url_for("admin_panel"))

    u = User(user_id=uid, role=role, state=state, manager_name=manager_name, district=district)
    u.set_password(pwd)
    db.session.add(u)
    db.session.commit()
    flash("User created successfully!", "success")
    return redirect(url_for("admin_panel"))

@app.route("/admin/delete/<int:user_id>", methods=["POST"])
def admin_delete_user(user_id):
    if session.get("role") != "Admin":
        abort(403)
    user = User.query.get(user_id)
    if not user:
        flash("User not found.", "danger")
    elif user.user_id == "admin":
        flash("Default admin cannot be deleted.", "warning")
    else:
        db.session.delete(user)
        db.session.commit()
        flash(f"User {user.user_id} deleted.", "info")
    return redirect(url_for("admin_panel"))

# -----------------------------------------------------------------------------
# Initialize database (works both locally and on Render)
# -----------------------------------------------------------------------------
with app.app_context():
    try:
        initialize_database()
    except Exception as e:
        print(f"⚠️ Database initialization skipped or failed: {e}")

# -----------------------------------------------------------------------------
# App Runner
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
