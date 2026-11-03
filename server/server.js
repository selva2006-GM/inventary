import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pool from "./db.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Inventory API is running!" });
});

// Get all products
app.get("/api/products", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM products WHERE is_active = TRUE ORDER BY created_at DESC"
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// Add a product
app.post("/api/products", async (req, res) => {
  try {
    const {
      name,
      image_url,
      purchase_price,
      selling_price,
      quantity,
    } = req.body;

    if (
      !name ||
      purchase_price < 0 ||
      selling_price < 0 ||
      quantity < 0 ||
      !Number.isInteger(Number(quantity))
    ) {
      return res.status(400).json({
        error: "Please provide valid product details.",
      });
    }

    const result = await pool.query(
      `INSERT INTO products
       (name, image_url, purchase_price, selling_price, quantity)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        name.trim(),
        image_url || null,
        purchase_price,
        selling_price,
        quantity,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to add product" });
  }
});


// Record a sale
app.post("/api/sales", async (req, res) => {
  const { product_id, quantity, actual_price } = req.body;

  const productId = Number(product_id);
  const qty = Number(quantity);
  const price = Number(actual_price);

  if (
    !Number.isInteger(productId) ||
    productId <= 0 ||
    !Number.isInteger(qty) ||
    qty <= 0 ||
    !Number.isFinite(price) ||
    price < 0
  ) {
    return res.status(400).json({
      error: "Enter a valid product, quantity, and selling price.",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Lock the product row to prevent overselling
    const productResult = await client.query(
      `SELECT * FROM products
       WHERE id = $1
       FOR UPDATE`,
      [productId]
    );

    if (productResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Product not found." });
    }

    const product = productResult.rows[0];

    if (qty > product.quantity) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Only ${product.quantity} items are available.`,
      });
    }

    const purchasePrice = Number(product.purchase_price);
    const regularPrice = Number(product.selling_price);

    const totalAmount = price * qty;
    const totalCost = purchasePrice * qty;
    const profit = totalAmount - totalCost;

    // Reduce stock
    const updatedProduct = await client.query(
      `UPDATE products
       SET quantity = quantity - $1
       WHERE id = $2
       RETURNING *`,
      [qty, productId]
    );

    // Save the sale
    const saleResult = await client.query(
      `INSERT INTO sales
       (product_id, quantity, purchase_price, regular_price,
        actual_price, total_amount, profit)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        productId,
        qty,
        purchasePrice,
        regularPrice,
        price,
        totalAmount,
        profit,
      ]
    );

    // Record the stock change
    await client.query(
      `INSERT INTO stock_logs
       (product_id, previous_quantity, new_quantity, change_type)
       VALUES ($1, $2, $3, $4)`,
      [
        productId,
        product.quantity,
        updatedProduct.rows[0].quantity,
        "sale",
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Sale recorded successfully.",
      sale: saleResult.rows[0],
      remaining_quantity: updatedProduct.rows[0].quantity,
      discount_per_item: Math.max(0, regularPrice - price),
      profit,
      loss: Math.max(0, -profit),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Failed to record sale." });
  } finally {
    client.release();
  }
});

// Get sales history
app.get("/api/sales", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, p.name AS product_name
       FROM sales s
       JOIN products p ON p.id = s.product_id
       ORDER BY s.sold_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch sales." });
  }
});




// Daily stock count
app.post("/api/stock-count", async (req, res) => {
  const { mode, counts } = req.body;

  if (
    !["selected", "all"].includes(mode) ||
    !Array.isArray(counts) ||
    counts.length === 0
  ) {
    return res.status(400).json({
      error: "Choose selected or all and provide stock counts.",
    });
  }

  const seen = new Set();

  for (const item of counts) {
    const id = Number(item.product_id);
    const quantity = Number(item.quantity);

    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      !Number.isInteger(quantity) ||
      quantity < 0 ||
      seen.has(id)
    ) {
      return res.status(400).json({
        error: "Invalid or duplicate product count.",
      });
    }

    seen.add(id);
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Lock all products in ID order
    const products = await client.query(
      "SELECT * FROM products ORDER BY id FOR UPDATE"
    );

    const productMap = new Map(
      products.rows.map((p) => [p.id, p])
    );

    if (
      mode === "all" &&
      counts.length !== products.rows.length
    ) {
      throw new Error(
        "Provide a count for every product in your inventory."
      );
    }

    const results = [];

    for (const item of counts) {
      const id = Number(item.product_id);
      const quantity = Number(item.quantity);
      const product = productMap.get(id);

      if (!product) {
        throw new Error(`Product ${id} was not found.`);
      }

      const previous = product.quantity;
      const difference = quantity - previous;

      await client.query(
        "UPDATE products SET quantity = $1 WHERE id = $2",
        [quantity, id]
      );

      await client.query(
        `INSERT INTO stock_logs
         (product_id, previous_quantity, new_quantity, change_type)
         VALUES ($1, $2, $3, $4)`,
        [id, previous, quantity, "stock_count"]
      );

      results.push({
        product_id: id,
        name: product.name,
        previous_quantity: previous,
        new_quantity: quantity,
        difference,
      });
    }

    await client.query("COMMIT");

    res.json({
      message: "Stock count saved successfully.",
      mode,
      products_updated: results.length,
      results,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);

    res.status(400).json({
      error: error.message || "Failed to save stock count.",
    });
  } finally {
    client.release();
  }
});


// Edit a product
app.put("/api/products/:id", async (req, res) => {
  const { name, image_url, purchase_price, selling_price, quantity } =
    req.body;

  const id = Number(req.params.id);
  const cost = Number(purchase_price);
  const price = Number(selling_price);
  const qty = Number(quantity);

  if (
    !Number.isInteger(id) ||
    id <= 0 ||
    !name?.trim() ||
    !Number.isFinite(cost) ||
    cost < 0 ||
    !Number.isFinite(price) ||
    price < 0 ||
    !Number.isInteger(qty) ||
    qty < 0
  ) {
    return res.status(400).json({
      error: "Invalid product details.",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT * FROM products
       WHERE id = $1 AND is_active = TRUE
       FOR UPDATE`,
      [id]
    );

    if (!existing.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Product not found." });
    }

    const product = existing.rows[0];

    const updated = await client.query(
      `UPDATE products
       SET name = $1,
           image_url = $2,
           purchase_price = $3,
           selling_price = $4,
           quantity = $5
       WHERE id = $6
       RETURNING *`,
      [name.trim(), image_url || null, cost, price, qty, id]
    );

    if (qty !== product.quantity) {
      await client.query(
        `INSERT INTO stock_logs
         (product_id, previous_quantity, new_quantity, change_type)
         VALUES ($1, $2, $3, 'manual_adjustment')`,
        [id, product.quantity, qty]
      );
    }

    await client.query("COMMIT");
    res.json(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Failed to update product." });
  } finally {
    client.release();
  }
});

// Archive a product
app.delete("/api/products/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid product ID." });
  }

  try {
    const result = await pool.query(
      `UPDATE products
       SET is_active = FALSE
       WHERE id = $1 AND is_active = TRUE
       RETURNING id, name`,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Product not found." });
    }

    res.json({
      message: "Product archived successfully.",
      product: result.rows[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to archive product." });
  }
});




app.listen(process.env.PORT || 5000, () => {
  console.log("Server running on port 5000");
});