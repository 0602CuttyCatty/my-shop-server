const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors({ origin: ["https://my-shop-omega-nine.vercel.app", "http://localhost:5173"] }));
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);
const ADMIN_EMAIL = "erica28810602school@gmail.com";

// ─── 상품 ───────────────────────────────────────────

app.get("/api/products", async (req, res) => {
  const { data, error } = await supabase.from("products").select("*").order("id");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/api/products", async (req, res) => {
  const { id, name, categories, stock, image_url, description } = req.body;
  const { data, error } = await supabase
    .from("products").insert({ id, name, categories, stock, image_url, description }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch("/api/products/:id/stock", async (req, res) => {
  const { stock } = req.body;
  const { data, error } = await supabase
    .from("products").update({ stock }).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─── 인증 ───────────────────────────────────────────

app.post("/api/auth/register", async (req, res) => {
  const { email, password, username } = req.body;
  try {
    const { data: existing } = await supabase.from("profiles").select("id").eq("username", username).maybeSingle();
    if (existing) return res.status(400).json({ error: "이미 사용 중인 아이디입니다" });
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    console.log("회원가입 유저:", data.user?.id, "아이디:", username);
    try {
      const { error: profileError } = await supabaseAdmin.from("profiles").insert({ id: data.user.id, username });
      if (profileError) console.error("프로필 저장 실패:", profileError.message);
      else console.log("프로필 저장 성공");
    } catch (profileErr) {
      console.error("프로필 저장 예외:", profileErr.message);
    }
    res.json({ user: data.user });
  } catch (err) {
    console.error("회원가입 전체 오류:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다" });
  const { data: profile } = await supabaseAdmin.from("profiles").select("username").eq("id", data.user.id).maybeSingle();
  const isAdmin = data.user.email === ADMIN_EMAIL;
  res.json({ user: { ...data.user, username: profile?.username }, token: data.session.access_token, isAdmin });
});

// 아이디 변경
app.patch("/api/auth/username", async (req, res) => {
  const { user_id, username } = req.body;
  const { data: existing } = await supabase.from("profiles").select("id").eq("username", username).maybeSingle();
  if (existing) return res.status(400).json({ error: "이미 사용 중인 아이디입니다" });
  const { data, error } = await supabase.from("profiles").update({ username }).eq("id", user_id).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─── 장바구니 ────────────────────────────────────────

// 장바구니 조회
app.get("/api/cart/:userId", async (req, res) => {
  const { data, error } = await supabase
    .from("carts")
    .select("*, products(id, name, image_url, stock, categories)")
    .eq("user_id", req.params.userId)
    .order("created_at");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 장바구니 담기
app.post("/api/cart", async (req, res) => {
  const { user_id, product_id, qty } = req.body;
  // 이미 있으면 수량 추가
  const { data: existing } = await supabase
    .from("carts").select("*").eq("user_id", user_id).eq("product_id", product_id).single();
  if (existing) {
    const { data, error } = await supabase
      .from("carts").update({ qty: existing.qty + qty }).eq("id", existing.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  const { data, error } = await supabase
    .from("carts").insert({ user_id, product_id, qty }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 장바구니 수량 변경
app.patch("/api/cart/:id", async (req, res) => {
  const { qty } = req.body;
  if (qty <= 0) {
    await supabase.from("carts").delete().eq("id", req.params.id);
    return res.json({ deleted: true });
  }
  const { data, error } = await supabase
    .from("carts").update({ qty }).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 장바구니 아이템 삭제
app.delete("/api/cart/:id", async (req, res) => {
  await supabase.from("carts").delete().eq("id", req.params.id);
  res.json({ deleted: true });
});

// ─── 주문 ───────────────────────────────────────────

// 장바구니에서 주문 (여러 상품 한번에)
app.post("/api/orders/bulk", async (req, res) => {
  const { user_id, items, exchange_items } = req.body;
  const results = [];
  for (const item of items) {
    const { data: product, error: productError } = await supabase
      .from("products").select("stock").eq("id", item.product_id).single();
    console.log("재고 확인:", item.product_id, "재고:", product?.stock, "요청:", item.qty, "에러:", productError?.message);
    if (productError || !product) {
      return res.status(404).json({ error: `상품을 찾을 수 없습니다 (${item.product_id})` });
    }
    if (product.stock < item.qty) {
      return res.status(400).json({ error: `재고가 부족합니다 (재고: ${product.stock}, 요청: ${item.qty})` });
    }
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({ user_id, product_id: item.product_id, qty: item.qty, exchange_items, status: "pending" })
      .select().single();
    if (orderError) return res.status(500).json({ error: orderError.message });
    results.push(order);
    if (item.cart_id) await supabase.from("carts").delete().eq("id", item.cart_id);
  }
  res.json(results);
});

// 내 주문 목록
app.get("/api/orders/user/:userId", async (req, res) => {
  const { data, error } = await supabase
    .from("orders")
    .select("*, products(name, image_url)")
    .eq("user_id", req.params.userId)
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 관리자 - 전체 주문 목록
app.get("/api/admin/orders", async (req, res) => {
  const { data: orders, error } = await supabase
    .from("orders")
    .select("*, products(name, image_url)")
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const userIds = [...new Set(orders.map(o => o.user_id).filter(Boolean))];
  const { data: profiles } = await supabase.from("profiles").select("id, username").in("id", userIds);
  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p; });
  res.json(orders.map(o => ({ ...o, profiles: profileMap[o.user_id] || null })));
});

// 관리자 - 주문 상태 변경
app.patch("/api/admin/orders/:id", async (req, res) => {
  const { status } = req.body;
  const orderId = req.params.id;
  const { data: order } = await supabase
    .from("orders").select("*, products(stock)").eq("id", orderId).single();
  if (!order) return res.status(404).json({ error: "주문을 찾을 수 없습니다" });
  if (status === "confirmed" && order.status !== "confirmed") {
    const newStock = Math.max(0, order.products.stock - order.qty);
    await supabase.from("products").update({ stock: newStock }).eq("id", order.product_id);
  }
  if (status === "cancelled" && order.status === "confirmed") {
    const newStock = order.products.stock + order.qty;
    await supabase.from("products").update({ stock: newStock }).eq("id", order.product_id);
  }
  const { data, error } = await supabase
    .from("orders").update({ status }).eq("id", orderId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 관리자 - 주문 수량 변경
app.patch("/api/admin/orders/:id/qty", async (req, res) => {
  const { qty } = req.body;
  if (!qty || qty < 1) return res.status(400).json({ error: "수량은 1 이상이어야 합니다" });
  const { data, error } = await supabase
    .from("orders").update({ qty }).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─── 채팅 ───────────────────────────────────────────

app.get("/api/messages/:orderId", async (req, res) => {
  const { data, error } = await supabase
    .from("messages").select("*").eq("order_id", req.params.orderId)
    .order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/api/messages", async (req, res) => {
  const { order_id, sender_id, content } = req.body;
  const { data, error } = await supabase
    .from("messages").insert({ order_id, sender_id, content }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`✅ 서버 실행 중 → http://localhost:${PORT}`));