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

// Get all active products
app.get("/api/products", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM products WHERE is_active = TRUE ORDER BY created_at DESC"
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch products." });
  }
});

// Add a product
app.post("/api/products", async (req, res) => {
  try {
    const { name, image_url, purchase_price, selling_price, quantity } =
      req.body;

    const cost = Number(purchase_price);
    const price = Number(selling_price);
    const qty = Number(quantity);

    if (
      !name?.trim() ||
      !Number.isFinite(cost) ||
      cost < 0 ||
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isInteger(qty) ||
      qty < 0
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
      [name.trim(), image_url || null, cost, price, qty]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to add product." });
  }
});

// Record a sale
app.post("/api/sales", async (req, res) => {
  const productId = Number(req.body.product_id);
  const qty = Number(req.body.quantity);
  const price = Number(req.body.actual_price);

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

    const productResult = await client.query(
      `SELECT * FROM products
       WHERE id = $1 AND is_active = TRUE
       FOR UPDATE`,
      [productId]
    );

    if (!productResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Product not found." });
    }

    const product = productResult.rows[0];
    const available = Number(product.quantity);

    if (qty > available) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Only ${available} items are available.`,
      });
    }

    const purchasePrice = Number(product.purchase_price);
    const regularPrice = Number(product.selling_price);
    const totalAmount = price * qty;
    const profit = totalAmount - purchasePrice * qty;

    const updatedProduct = await client.query(
      `UPDATE products
       SET quantity = quantity - $1
       WHERE id = $2
       RETURNING *`,
      [qty, productId]
    );

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

    await client.query(
      `INSERT INTO stock_logs
       (product_id, previous_quantity, new_quantity, change_type)
       VALUES ($1, $2, $3, $4)`,
      [
        productId,
        available,
        Number(updatedProduct.rows[0].quantity),
        "sale",
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Sale recorded successfully.",
      sale: saleResult.rows[0],
      remaining_quantity: Number(updatedProduct.rows[0].quantity),
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

// Adjust stock for one product.
// Decrease = record a sale at the current selling price.
// Increase = add stock only.
// No change = do nothing.
app.post("/api/stock-count", async (req, res) => {
  const { counts } = req.body;

  if (!Array.isArray(counts) || counts.length !== 1) {
    return res.status(400).json({
      error: "Provide one product and its new stock quantity.",
    });
  }

  const productId = Number(counts[0].product_id);
  const newQuantity = Number(counts[0].quantity);

  if (
    !Number.isInteger(productId) ||
    productId <= 0 ||
    !Number.isInteger(newQuantity) ||
    newQuantity < 0
  ) {
    return res.status(400).json({
      error: "Product ID and stock quantity must be valid whole numbers.",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const found = await client.query(
      `SELECT * FROM products
       WHERE id = $1 AND is_active = TRUE
       FOR UPDATE`,
      [productId]
    );

    if (!found.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Product not found." });
    }

    const product = found.rows[0];
    const previousQuantity = Number(product.quantity);
    const difference = previousQuantity - newQuantity;

    if (difference === 0) {
      await client.query("COMMIT");
      return res.json({
        message: "Stock is unchanged.",
        product_id: productId,
        previous_quantity: previousQuantity,
        new_quantity: newQuantity,
        sale: null,
      });
    }

    await client.query(
      "UPDATE products SET quantity = $1 WHERE id = $2",
      [newQuantity, productId]
    );

    await client.query(
      `INSERT INTO stock_logs
       (product_id, previous_quantity, new_quantity, change_type)
       VALUES ($1, $2, $3, $4)`,
      [
        productId,
        previousQuantity,
        newQuantity,
        difference > 0 ? "sale_stock_adjustment" : "stock_increase",
      ]
    );

    let sale = null;

    if (difference > 0) {
      const quantitySold = difference;
      const purchasePrice = Number(product.purchase_price);
      const regularPrice = Number(product.selling_price);
      const totalAmount = regularPrice * quantitySold;
      const profit = totalAmount - purchasePrice * quantitySold;

      const saleResult = await client.query(
        `INSERT INTO sales
         (product_id, quantity, purchase_price, regular_price,
          actual_price, total_amount, profit)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          productId,
          quantitySold,
          purchasePrice,
          regularPrice,
          regularPrice,
          totalAmount,
          profit,
        ]
      );

      sale = saleResult.rows[0];
    }

    await client.query("COMMIT");

    res.json({
      message:
        difference > 0
          ? `Stock reduced; ${difference} item(s) recorded as a sale.`
          : `Stock increased by ${Math.abs(difference)} item(s).`,
      product_id: productId,
      previous_quantity: previousQuantity,
      new_quantity: newQuantity,
      sale,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Failed to adjust stock." });
  } finally {
    client.release();
  }
});

// Edit product details.
// Stock quantity changes made here are logged as manual adjustments.
app.put("/api/products/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, image_url, purchase_price, selling_price, quantity } =
    req.body;

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
    return res.status(400).json({ error: "Invalid product details." });
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

    if (qty !== Number(product.quantity)) {
      await client.query(
        `INSERT INTO stock_logs
         (product_id, previous_quantity, new_quantity, change_type)
         VALUES ($1, $2, $3, 'manual_adjustment')`,
        [id, Number(product.quantity), qty]
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

// Get stock change history
app.get("/api/stock-logs", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        sl.id,
        sl.product_id,
        p.name AS product_name,
        sl.previous_quantity,
        sl.new_quantity,
        sl.change_type,
        sl.created_at
      FROM stock_logs sl
      LEFT JOIN products p ON p.id = sl.product_id
      ORDER BY sl.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Failed to fetch stock logs:", error);
    res.status(500).json({ error: "Failed to fetch stock logs." });
  }
});

// Edit a sale and adjust inventory by the quantity difference
app.put("/api/sales/:id", async (req, res) => {
  const saleId = Number(req.params.id);
  const quantity = Number(req.body.quantity);
  const actualPrice = Number(req.body.actual_price);

  if (
    !Number.isInteger(saleId) || saleId <= 0 ||
    !Number.isInteger(quantity) || quantity <= 0 ||
    !Number.isFinite(actualPrice) || actualPrice < 0
  ) {
    return res.status(400).json({ error: "Enter a valid quantity and price." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const saleResult = await client.query(
      "SELECT * FROM sales WHERE id = $1 FOR UPDATE",
      [saleId]
    );

    if (!saleResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Sale not found." });
    }

    const sale = saleResult.rows[0];
    const oldQuantity = Number(sale.quantity);
    const difference = oldQuantity - quantity;

    const productResult = await client.query(
      "SELECT * FROM products WHERE id = $1 FOR UPDATE",
      [sale.product_id]
    );

    if (!productResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Product not found." });
    }

    const product = productResult.rows[0];
    const newStock = Number(product.quantity) + difference;

    if (newStock < 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Not enough stock to increase this sale quantity."
      });
    }

    const purchasePrice = Number(sale.purchase_price);
    const totalAmount = actualPrice * quantity;
    const profit = totalAmount - purchasePrice * quantity;

    await client.query(
      "UPDATE products SET quantity = $1 WHERE id = $2",
      [newStock, sale.product_id]
    );

    const updatedSale = await client.query(
      `UPDATE sales
       SET quantity = $1,
           actual_price = $2,
           total_amount = $3,
           profit = $4
       WHERE id = $5
       RETURNING *`,
      [quantity, actualPrice, totalAmount, profit, saleId]
    );

    await client.query(
      `INSERT INTO stock_logs
       (product_id, previous_quantity, new_quantity, change_type)
       VALUES ($1, $2, $3, 'sale_edited')`,
      [sale.product_id, Number(product.quantity), newStock]
    );

    await client.query("COMMIT");
    res.json(updatedSale.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Failed to edit sale." });
  } finally {
    client.release();
  }
});

// Delete a sale and return its quantity to inventory
app.delete("/api/sales/:id", async (req, res) => {
  const saleId = Number(req.params.id);

  if (!Number.isInteger(saleId) || saleId <= 0) {
    return res.status(400).json({ error: "Invalid sale ID." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const saleResult = await client.query(
      "SELECT * FROM sales WHERE id = $1 FOR UPDATE",
      [saleId]
    );

    if (!saleResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Sale not found." });
    }

    const sale = saleResult.rows[0];

    const productResult = await client.query(
      "SELECT * FROM products WHERE id = $1 FOR UPDATE",
      [sale.product_id]
    );

    if (!productResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Product not found." });
    }

    const previousStock = Number(productResult.rows[0].quantity);
    const newStock = previousStock + Number(sale.quantity);

    await client.query(
      "UPDATE products SET quantity = $1 WHERE id = $2",
      [newStock, sale.product_id]
    );

    await client.query("DELETE FROM sales WHERE id = $1", [saleId]);

    await client.query(
      `INSERT INTO stock_logs
       (product_id, previous_quantity, new_quantity, change_type)
       VALUES ($1, $2, $3, 'sale_deleted')`,
      [sale.product_id, previousStock, newStock]
    );

    await client.query("COMMIT");
    res.json({ message: "Sale deleted and stock restored." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Failed to delete sale." });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});