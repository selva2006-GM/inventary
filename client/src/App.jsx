import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  ClipboardList,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Menu,
  TrendingUp,
  Wallet,
} from "lucide-react";
import "./App.css";

const API = "http://localhost:5000/api"; 

const emptyForm = {
  name: "",
  purchase_price: "",
  selling_price: "",
  quantity: "",
  image_url: "",
};

const emptySaleForm = {
  product_id: "",
  quantity: "1",
  actual_price: "",
};
async function editSale(sale) {
    const quantityInput = prompt("Updated quantity:", sale.quantity);
    if (quantityInput === null) return;
  
    const priceInput = prompt("Actual price per item (₹):", sale.actual_price);
    if (priceInput === null) return;
  
    const quantity = Number(quantityInput);
    const actual_price = Number(priceInput);
  
    if (!Number.isInteger(quantity) || quantity <= 0 ||
        !Number.isFinite(actual_price) || actual_price < 0) {
      alert("Enter a valid quantity and price.");
      return;
    }
  
    try {
      const response = await fetch(`${API}/sales/${sale.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity, actual_price }),
      });
  
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not edit sale.");
  
      await Promise.all([loadSales(), loadProducts()]);
    } catch (error) {
      alert(error.message);
    }
  }
  
  async function deleteSale(sale) {
    if (!confirm(`Delete this sale of ${sale.quantity} item(s)? The stock will be restored.`)) {
      return;
    }
  
    try {
      const response = await fetch(`${API}/sales/${sale.id}`, {
        method: "DELETE",
      });
  
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete sale.");
  
      await Promise.all([loadSales(), loadProducts()]);
    } catch (error) {
      alert(error.message);
    }
  }

export default function App() {
    const [theme, setTheme] = useState(
        () => localStorage.getItem("inventary-theme") || "dark"
      );
      
      useEffect(() => {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem("inventary-theme", theme);
      }, [theme]);
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState("dashboard");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [menu, setMenu] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [form, setForm] = useState(emptyForm);
  const [saleForm, setSaleForm] = useState(emptySaleForm);
  const [saleMessage, setSaleMessage] = useState("");
  const [saleError, setSaleError] = useState("");
  const [loadingSale, setLoadingSale] = useState(false);

  const [imagePreview, setImagePreview] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [stockCounts, setStockCounts] = useState({});
  const [stockModal, setStockModal] = useState(false);
const [stockMessage, setStockMessage] = useState("");
const [stockError, setStockError] = useState("");
const [savingStock, setSavingStock] = useState(false);

function updateStockCount(productId, quantity) {
  setStockCounts((previous) => ({
    ...previous,
    [productId]: quantity,
  }));
}

async function saveStockCount() {
  const counts = Object.entries(stockCounts).map(([product_id, quantity]) => ({
    product_id: Number(product_id),
    quantity: Number(quantity),
  }));

  if (!counts.length) {
    setStockError("Enter a counted quantity for at least one product.");
    return;
  }

  if (counts.some((item) => !Number.isInteger(item.quantity) || item.quantity < 0)) {
    setStockError("Quantities must be whole numbers, zero or greater.");
    return;
  }

  setSavingStock(true);
  setStockMessage("");
  setStockError("");

  try {
    const response = await fetch(`${API}/stock-count`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "selected", counts }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not save stock count.");
    }

    setStockMessage(data.message || "Stock count saved.");
    setStockCounts({});
    await loadProducts();
  } catch (error) {
    setStockError(error.message);
  } finally {
    setSavingStock(false);
  }
}

const [stockLogs, setStockLogs] = useState([]);

async function loadStockLogs() {
  const response = await fetch(`${API}/stock-logs`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not load stock logs");
  }

  setStockLogs(Array.isArray(data) ? data : []);
}

  async function loadProducts() {
    const response = await fetch(`${API}/products`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load products");
    }

    setProducts(Array.isArray(data) ? data : []);
  }

  async function loadSales() {
    const response = await fetch(`${API}/sales`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load sales");
    }

    setSales(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    loadProducts().catch((error) => console.error(error));
  }, []);

  const totalInvestment = products.reduce(
    (sum, product) =>
      sum + Number(product.purchase_price) * Number(product.quantity),
    0
  );
  
  const totalSalesRevenue = sales.reduce(
    (sum, sale) => sum + Number(sale.total_amount || 0),
    0
  );
  
  const totalInvestmentRecovered = sales.reduce(
    (sum, sale) =>
      sum + Number(sale.purchase_price || 0) * Number(sale.quantity || 0),
    0
  );
  
  const totalRealizedProfit = sales.reduce(
    (sum, sale) => sum + Number(sale.profit || 0),
    0
  );

  const filtered = products.filter((product) =>
    product.name.toLowerCase().includes(search.toLowerCase())
  );

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setImagePreview("");
    setModal(true);
  }

  function openEdit(product) {
    setEditing(product);
    setForm({
      name: product.name,
      purchase_price: product.purchase_price,
      selling_price: product.selling_price,
      quantity: product.quantity,
      image_url: product.image_url || "",
    });
    setImagePreview(product.image_url || "");
    setModal(true);
  }

  async function uploadPhoto(file) {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please take or select an image.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert("Please choose an image smaller than 5 MB.");
      return;
    }

    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

    if (!cloudName || !uploadPreset) {
      alert("Cloudinary settings are missing from client/.env.");
      return;
    }

    const uploadData = new FormData();
    uploadData.append("file", file);
    uploadData.append("upload_preset", uploadPreset);

    setPhotoUploading(true);

    try {
        const response = await fetch(
            `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
            {
              method: "POST",
              body: uploadData,
            }
          );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error?.message || "Photo upload failed");
      }

      setForm((previous) => ({
        ...previous,
        image_url: result.secure_url,
      }));
      setImagePreview(result.secure_url);
    } catch (error) {
      alert(error.message);
    } finally {
      setPhotoUploading(false);
    }
  }

  function handlePhotoChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImagePreview(URL.createObjectURL(file));
    uploadPhoto(file);

    // Allows choosing the same photo again if needed.
    event.target.value = "";
  }

  async function saveProduct(event) {
    event.preventDefault();

    if (photoUploading) {
      alert("Please wait for the photo upload to finish.");
      return;
    }

    const url = editing
      ? `${API}/products/${editing.id}`
      : `${API}/products`;

    try {
      const response = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          purchase_price: Number(form.purchase_price),
          selling_price: Number(form.selling_price),
          quantity: Number(form.quantity),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not save product");
      }

      setModal(false);
      setForm(emptyForm);
      setImagePreview("");
      await loadProducts();
    } catch (error) {
      alert(error.message);
    }
  }

  async function deleteProduct(product) {
    if (!confirm(`Archive ${product.name}?`)) return;

    try {
      const response = await fetch(`${API}/products/${product.id}`, {
        method: "DELETE",
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not archive product");
      }

      await loadProducts();
    } catch (error) {
      alert(error.message);
    }
  }

  async function openSalesPage() {
    setPage("sales");
    setSaleMessage("");
    setSaleError("");

    try {
      await loadSales();
    } catch (error) {
      setSaleError(error.message);
    }
  }

  async function submitSale(event) {
    event.preventDefault();
    setSaleMessage("");
    setSaleError("");

    if (!saleForm.product_id) {
      setSaleError("Choose a product.");
      return;
    }

    const quantity = Number(saleForm.quantity);
    const actualPrice = Number(saleForm.actual_price);

    if (!Number.isInteger(quantity) || quantity < 1) {
      setSaleError("Quantity must be a whole number greater than zero.");
      return;
    }

    if (!Number.isFinite(actualPrice) || actualPrice < 0) {
      setSaleError("Enter a valid selling price.");
      return;
    }

    setLoadingSale(true);

    try {
      const response = await fetch(`${API}/sales`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: Number(saleForm.product_id),
          quantity,
          actual_price: actualPrice,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not save sale");
      }

      setSaleMessage("Sale saved. Inventory stock has been updated.");
      setSaleForm(emptySaleForm);

      await Promise.all([loadProducts(), loadSales()]);
    } catch (error) {
      setSaleError(error.message);
    } finally {
      setLoadingSale(false);
    }
  }

  function formatMoney(value) {
    return Number(value || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function getSaleProductName(sale) {
    if (sale.product_name) return sale.product_name;

    const product = products.find(
      (item) => Number(item.id) === Number(sale.product_id)
    );

    return product?.name || `Product #${sale.product_id}`;
  }

  return (
    <div className="app">
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <div className="brand">
          <Package size={24} />
          <span>Inventary</span>
          <button
            className="close-menu"
            type="button"
            onClick={() => setMenu(false)}
            aria-label="Close menu"
          >
            <X />
          </button>
        </div>

        <nav>
          {[
            ["dashboard", LayoutDashboard, "Dashboard"],
            ["products", Package, "Products"],
            ["sales", ShoppingCart, "Sales"],
            ["history", ClipboardList, "History"],
            ["stock", Package, "Stock"],
          ].map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              className={page === id ? "nav-item active" : "nav-item"}
              onClick={() => {
                setPage(id);
                setMenu(false);

                if (id === "sales") openSalesPage();
                if (id === "history") Promise.all([loadSales(), loadStockLogs()]).catch((error) => setSaleError(error.message));
              }}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">Inventory management</div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="menu-button"
            type="button"
            onClick={() => setMenu(!menu)}
            aria-label="Toggle menu"
          >
            <Menu />
          </button>

          <div>
            <h1>
              {page === "dashboard"
                ? "Dashboard"
                : page === "products"
                ? "Products"
                : page === "sales"
                ? "Sales"
                : page === "history"
                ? "Sales history"
                : "Stock"}
            </h1>
            <p>Manage your inventory in one place.</p>
          </div>

          {page !== "sales" && page !== "stock" && (
            <button className="primary add-top" type="button" onClick={openAdd}>
              <Plus size={18} /> Add product
            </button>
            
          )}
          <button
  type="button"
  className="theme-toggle"
  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
>
  {theme === "dark" ? "☀ Light mode" : "☾ Dark mode"}
</button>
        </header>
        {page === "dashboard" && (
  <section className="stats">
    <div className="stat-card">
      <div className="stat-icon">
        <Wallet />
      </div>
      <p>Stock investment</p>
      <h2>₹{formatMoney(totalInvestment)}</h2>
      <small>Cost of the stock currently on hand</small>
    </div>

    <div className="stat-card">
      <div className="stat-icon">
        <ShoppingCart />
      </div>
      <p>Sales revenue</p>
      <h2>₹{formatMoney(totalSalesRevenue)}</h2>
      <small>Total money received from recorded sales</small>
    </div>

    <div className="stat-card">
      <div className="stat-icon">
        <Wallet />
      </div>
      <p>Investment recovered</p>
      <h2>₹{formatMoney(totalInvestmentRecovered)}</h2>
      <small>Cost of the items sold</small>
    </div>

    <div className="stat-card">
      <div className="stat-icon green">
        <TrendingUp />
      </div>
      <p>Realized profit</p>
      <h2>₹{formatMoney(totalRealizedProfit)}</h2>
      <small>Profit or loss from completed sales</small>
    </div>

    <div className="stat-card">
      <div className="stat-icon">
        <Package />
      </div>
      <p>Total products</p>
      <h2>{products.length}</h2>
    </div>
  </section>
)}

        {(page === "dashboard" || page === "products") && (
          <section className="content-card">
            <div className="section-heading">
              <div>
                <h2>
                  {page === "dashboard" ? "Inventory overview" : "Products"}
                </h2>
                <p>{products.length} products in your inventory</p>
              </div>

              <div className="search">
                <Search size={17} />
                <input
                  placeholder="Search products..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>

            <div className="product-grid">
              {filtered.map((product) => (
                <article className="product-card" key={product.id}>
                  <div className="product-image">
                    {product.image_url ? (
                      <img src={product.image_url} alt={product.name} />
                    ) : (
                      <Package size={36} />
                    )}
                  </div>

                  <div className="product-info">
                    <h3>{product.name}</h3>
                    <p>
                      Stock: <strong>{product.quantity}</strong>
                    </p>
                    <p>
                      Cost: ₹{formatMoney(product.purchase_price)}
                    </p>
                    <p>
                      Selling: ₹{formatMoney(product.selling_price)}
                    </p>
                  </div>

                  <div className="product-actions">
                    <button
                      type="button"
                      onClick={() => openEdit(product)}
                      title="Edit product"
                      aria-label={`Edit ${product.name}`}
                    >
                      <Pencil size={17} />
                    </button>
                    <button
                      className="delete-button"
                      type="button"
                      onClick={() => deleteProduct(product)}
                      title="Archive product"
                      aria-label={`Archive ${product.name}`}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </article>
              ))}

              {filtered.length === 0 && (
                <div className="empty">
                  <Package size={40} />
                  <p>No products found</p>
                  <button className="primary" type="button" onClick={openAdd}>
                    <Plus size={18} /> Add your first product
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {page === "sales" && (
          <section className="content-card sales-page">
            <div className="section-heading">
              <div>
                <h2>Record a sale</h2>
                <p>Enter the price you actually charged per item.</p>
              </div>
            </div>

            <form className="sale-form" onSubmit={submitSale}>
              <label>
                Product
                <div className="sale-product-grid">
  {products
    .filter((product) => Number(product.quantity) > 0)
    .map((product) => (
      <button
        type="button"
        key={product.id}
        className="sale-product-card"
        onClick={() => {
          setSelectedProduct(product);
          setSaleForm({
            product_id: String(product.id),
            quantity: "1",
            actual_price: String(product.selling_price),
          });
          setSaleMessage("");
          setSaleError("");
        }}
      >
        <div className="sale-product-image">
          {product.image_url ? (
            <img src={product.image_url} alt={product.name} />
          ) : (
            <Package size={32} />
          )}
        </div>
        <strong>{product.name}</strong>
        <span>Stock: {product.quantity}</span>
        <span>Selling: ₹{formatMoney(product.selling_price)}</span>
      </button>
    ))}
</div>


              </label>

              <label>
                Quantity sold
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={saleForm.quantity}
                  onChange={(event) =>
                    setSaleForm({
                      ...saleForm,
                      quantity: event.target.value,
                    })
                  }
                  required
                />
              </label>

              <label>
                Actual selling price per item (₹)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={saleForm.actual_price}
                  onChange={(event) =>
                    setSaleForm({
                      ...saleForm,
                      actual_price: event.target.value,
                    })
                  }
                  placeholder="Enter the price charged"
                  required
                />
              </label>

              {saleMessage && (
                <p className="success-message" role="status">
                  {saleMessage}
                </p>
              )}

              {saleError && (
                <p className="error-message" role="alert">
                  {saleError}
                </p>
              )}

              <button
                className="primary save-button"
                type="submit"
                disabled={loadingSale}
              >
                {loadingSale ? "Saving sale..." : "Save sale"}
              </button>
            </form>


          </section>
        )}



{page === "history" && (
  <section className="content-card">
    <div className="section-heading">
      <div>
        <h2>Sales history</h2>
        <p>{sales.length} recorded sales</p>
      </div>

      <button
        type="button"
        onClick={() => loadSales().catch((error) => setSaleError(error.message))}
      >
        Refresh
      </button>
    </div>

    {saleError && <p className="error-message">{saleError}</p>}
    

    <div className="table-wrapper">
      <table className="sales-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Quantity</th>
            <th>Price per item</th>
            <th>Total sale</th>
            <th>Profit</th>
            <th>Date</th>
          <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sales.map((sale) => (
            <tr key={sale.id}>
              <td>{getSaleProductName(sale)}</td>
              <td>{sale.quantity}</td>
              <td>₹{formatMoney(sale.actual_price)}</td>
              <td>₹{formatMoney(sale.total_amount)}</td>
              <td>₹{formatMoney(sale.profit)}</td>
              <td>
                {sale.sold_at
                  ? new Date(sale.sold_at).toLocaleString()
                  : "—"}
              </td>
              <td className="sale-actions">
  <button
    type="button"
    onClick={() => editSale(sale)}
  >
    Edit
  </button>

  <button
    type="button"
    className="delete-button"
    onClick={() => deleteSale(sale)}
  >
    Delete
  </button>
</td>
            </tr>
          ))}

          {sales.length === 0 && (
            <tr>
              <td colSpan="6" className="empty-row">
                No sales recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </section>
)}

        {page === "stock" && (
          <section className="content-card stock-page">
            <div className="section-heading">
              <div><h2>Stock</h2><p>Choose a product card to adjust its quantity.</p></div>
            </div>
            {stockMessage && <p className="success-message" role="status">{stockMessage}</p>}
            {stockError && <p className="error-message" role="alert">{stockError}</p>}
            {products.length === 0 ? <p className="empty-message">No products to manage yet.</p> : (
              <div className="stock-card-grid">
                {products.map((product) => (
                  <button className="stock-product-card" type="button" key={product.id} onClick={() => { setSelectedProduct(product); setStockCounts({ [product.id]: String(product.quantity) }); setStockError(""); setStockMessage(""); setStockModal(true); }}>
                    <span className="stock-card-name">{product.name}</span>
                    <strong>{product.quantity} <small>in stock</small></strong>
                    <span className="stock-card-hint">Click to adjust</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

      </main>

      {stockModal && selectedProduct && (
        <div className="modal-backdrop" onClick={() => setStockModal(false)}>
          <form className="modal stock-adjust-modal" onSubmit={(event) => { event.preventDefault(); saveStockCount(); }} onClick={(event) => event.stopPropagation()}>
            <div className="modal-heading"><h2>Adjust stock</h2><button type="button" onClick={() => setStockModal(false)} aria-label="Close stock editor"><X /></button></div>
            <p>{selectedProduct.name} · Current stock: {selectedProduct.quantity}</p>
            <label>New quantity<input type="number" min="0" step="1" required value={stockCounts[selectedProduct.id] ?? ""} onChange={(event) => updateStockCount(selectedProduct.id, event.target.value)} /></label>
            <small>Reducing stock records the difference as a sale at the current selling price. Increasing stock only adjusts inventory.</small>
            <button className="primary save-button" type="submit" disabled={savingStock}>{savingStock ? "Saving…" : "Save stock"}</button>
          </form>
        </div>
      )}

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(false)}>
          <form
            className="modal"
            onSubmit={saveProduct}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <h2>{editing ? "Edit product" : "Add product"}</h2>
              <button
                type="button"
                onClick={() => setModal(false)}
                aria-label="Close form"
              >
                <X />
              </button>
            </div>

            <label>
              Product name
              <input
                required
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </label>

            <label className="photo-button">
              {photoUploading ? "Uploading photo..." : "Take photo"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoChange}
                hidden
              />
            </label>

            {imagePreview && (
              <img
                src={imagePreview}
                alt="Product preview"
                className="photo-preview"
              />
            )}

            <div className="form-grid">
              <label>
                Purchase price (₹)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.purchase_price}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      purchase_price: event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Selling price (₹)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.selling_price}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      selling_price: event.target.value,
                    })
                  }
                />
              </label>
            </div>

            <label>
              Quantity
              <input
                type="number"
                min="0"
                step="1"
                required
                value={form.quantity}
                onChange={(event) =>
                  setForm({ ...form, quantity: event.target.value })
                }
              />
            </label>

            <button
              className="primary save-button"
              type="submit"
              disabled={photoUploading}
            >
              {photoUploading
                ? "Please wait for photo upload..."
                : editing
                ? "Save changes"
                : "Add product"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}