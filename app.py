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

        # ✅ Convert date-like columns to string
        for col in df.columns:
            if "date" in col.lower() or "month" in col.lower():
                df[col] = df[col].astype(str)

        # ✅ Round numeric columns to 0 decimals (no .0)
        for col in df.columns:
            if pd.api.types.is_numeric_dtype(df[col]):
                df[col] = df[col].round(0).astype(int)

        return jsonify(df.to_dict(orient="records"))

    except Exception as e:
        print("❌ Error loading data:", e)
        return jsonify({"error": str(e)}), 500
