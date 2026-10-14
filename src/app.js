require("dotenv").config();

const express = require("express");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const createOrderRoutes = require("./orderRoutes");
const createShipmentRoutes = require("./shipmentRoutes");

const app = express();
const prisma = new PrismaClient();

const port = Number(process.env.PORT || 3001);
const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error("JWT_SECRET phải có ít nhất 32 ký tự.");
}

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

// ==================== TRANG CHỦ ====================

app.get("/", (req, res) => {
  res.json({
    message: "E-commerce API đang hoạt động",
  });
});

// ==================== HEALTH CHECK ====================

app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: "ok",
      database: "connected",
    });
  } catch (error) {
    console.error("Health check failed:", error.message);

    res.status(503).json({
      status: "error",
      database: "disconnected",
    });
  }
});

// ==================== ĐĂNG KÝ ====================

app.post("/api/auth/register", async (req, res) => {
  const { username, fullname, password } = req.body || {};

  if (
    typeof username !== "string" ||
    !/^[a-zA-Z0-9_]{3,50}$/.test(username)
  ) {
    return res.status(400).json({
      message:
        "Tên đăng nhập gồm 3–50 chữ cái, chữ số hoặc dấu gạch dưới.",
    });
  }

  if (
    typeof fullname !== "string" ||
    !fullname.trim() ||
    fullname.trim().length > 100
  ) {
    return res.status(400).json({
      message: "Họ tên phải có từ 1 đến 100 ký tự.",
    });
  }

  if (
    typeof password !== "string" ||
    password.length < 8 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    return res.status(400).json({
      message: "Mật khẩu phải có ít nhất 8 ký tự và tối đa 72 byte.",
    });
  }

  const role = await prisma.role.findFirst({
    where: { rolename: "CUSTOMER" },
  });

  const membership = await prisma.memberShip.findFirst({
    where: { mname: "STANDARD" },
  });

  if (!role || !membership) {
    return res.status(500).json({
      message: "Thiếu dữ liệu vai trò hoặc hạng thành viên.",
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      username,
      fullname: fullname.trim(),
      password: passwordHash,
      roleid: role.roleid,
      mid: membership.mid,
    },
    select: {
      uid: true,
      username: true,
      fullname: true,
    },
  });

  res.status(201).json({
    message: "Đăng ký thành công.",
    user,
  });
});

// ==================== ĐĂNG NHẬP ====================

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};

  if (
    typeof username !== "string" ||
    !username.trim() ||
    username.length > 50 ||
    typeof password !== "string" ||
    !password ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    return res.status(400).json({
      message: "Tên đăng nhập hoặc mật khẩu không hợp lệ.",
    });
  }

  const user = await prisma.user.findUnique({
    where: { username: username.trim() },
    include: { role: true },
  });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({
      message: "Sai tên đăng nhập hoặc mật khẩu.",
    });
  }

  const token = jwt.sign({}, jwtSecret, {
    subject: String(user.uid),
    algorithm: "HS256",
    expiresIn: process.env.JWT_EXPIRES_IN || "1h",
  });

  res.json({
    message: "Đăng nhập thành công.",
    token,
    user: {
      uid: user.uid,
      username: user.username,
      fullname: user.fullname,
      role: user.role.rolename,
    },
  });
});

// ==================== XÁC THỰC JWT ====================

async function authenticate(req, res, next) {
  const authorization = req.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(\S+)$/i);

  if (!match) {
    return res.status(401).json({
      message: "Bạn cần gửi token theo dạng Bearer.",
    });
  }

  let payload;

  try {
    payload = jwt.verify(match[1], jwtSecret, {
      algorithms: ["HS256"],
    });
  } catch {
    return res.status(401).json({
      message: "Token không hợp lệ hoặc đã hết hạn.",
    });
  }

  const uid = Number(payload.sub);

  if (!Number.isInteger(uid) || uid <= 0 || uid > 2147483647) {
    return res.status(401).json({
      message: "Token không hợp lệ.",
    });
  }

  const user = await prisma.user.findUnique({
    where: { uid },
    select: {
      uid: true,
      username: true,
      fullname: true,
      role: {
        select: { rolename: true },
      },
      membership: {
        select: { mname: true, score: true },
      },
    },
  });

  if (!user) {
    return res.status(401).json({
      message: "Tài khoản không còn tồn tại.",
    });
  }

  req.user = user;
  next();
}

// ==================== PHÂN QUYỀN ADMIN ====================

function requireAdmin(req, res, next) {
  if (req.user.role.rolename !== "ADMIN") {
    return res.status(403).json({
      message: "Bạn không có quyền quản trị.",
    });
  }

  next();
}

// ==================== TÀI KHOẢN HIỆN TẠI ====================

app.get("/api/auth/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});

// ==================== KIỂM TRA SẢN PHẨM ====================

function validateProductId(req, res, next) {
  const pid = Number(req.params.pid);

  if (!Number.isInteger(pid) || pid <= 0 || pid > 2147483647) {
    return res.status(400).json({
      message: "Mã sản phẩm không hợp lệ.",
    });
  }

  req.productId = pid;
  next();
}

function validateProduct(req, res, next) {
  const { pname, price, quantity } = req.body || {};

  if (
    typeof pname !== "string" ||
    !pname.trim() ||
    pname.trim().length > 100
  ) {
    return res.status(400).json({
      message: "Tên sản phẩm phải có từ 1 đến 100 ký tự.",
    });
  }

  const priceText =
    typeof price === "string" || typeof price === "number"
      ? String(price)
      : "";

  if (!/^\d{1,8}(\.\d{1,2})?$/.test(priceText)) {
    return res.status(400).json({
      message: "Giá phải từ 0 đến 99999999.99, tối đa 2 số thập phân.",
    });
  }

  if (
    !Number.isInteger(quantity) ||
    quantity < 0 ||
    quantity > 2147483647
  ) {
    return res.status(400).json({
      message: "Số lượng phải là số nguyên không âm trong phạm vi INT.",
    });
  }

  req.productData = {
    pname: pname.trim(),
    price: priceText,
    quantity,
  };

  next();
}

// ==================== DANH SÁCH SẢN PHẨM ====================

app.get("/api/products", async (req, res) => {
  const page = Number(req.query.page || 1);

  if (!Number.isInteger(page) || page < 1 || page > 1000000) {
    return res.status(400).json({
      message: "Số trang không hợp lệ.",
    });
  }

  const products = await prisma.product.findMany({
    orderBy: { pid: "asc" },
    skip: (page - 1) * 20,
    take: 20,
  });

  res.json({ page, products });
});

// ==================== CHI TIẾT SẢN PHẨM ====================

app.get("/api/products/:pid", validateProductId, async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { pid: req.productId },
  });

  if (!product) {
    return res.status(404).json({
      message: "Không tìm thấy sản phẩm.",
    });
  }

  res.json({ product });
});

// ==================== TẠO SẢN PHẨM ====================

app.post(
  "/api/products",
  authenticate,
  requireAdmin,
  validateProduct,
  async (req, res) => {
    const product = await prisma.product.create({
      data: req.productData,
    });

    res.status(201).json({
      message: "Tạo sản phẩm thành công.",
      product,
    });
  }
);

// ==================== CẬP NHẬT SẢN PHẨM ====================

app.put(
  "/api/products/:pid",
  authenticate,
  requireAdmin,
  validateProductId,
  validateProduct,
  async (req, res) => {
    const product = await prisma.product.update({
      where: { pid: req.productId },
      data: req.productData,
    });

    res.json({
      message: "Cập nhật sản phẩm thành công.",
      product,
    });
  }
);

// ==================== XÓA SẢN PHẨM ====================

app.delete(
  "/api/products/:pid",
  authenticate,
  requireAdmin,
  validateProductId,
  async (req, res) => {
    await prisma.product.delete({
      where: { pid: req.productId },
    });

    res.status(204).end();
  }
);

// ==================== ĐƠN HÀNG ====================

app.use("/api/orders", createOrderRoutes(prisma, authenticate));

// ==================== VẬN CHUYỂN ====================

app.use(
  "/api/shipments",
  createShipmentRoutes(prisma, authenticate, requireAdmin)
);

// ==================== API KHÔNG TỒN TẠI ====================

app.use((req, res) => {
  res.status(404).json({
    message: "API không tồn tại.",
  });
});

// ==================== XỬ LÝ LỖI ====================

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error.code === "P2025") {
    return res.status(404).json({
      message: "Không tìm thấy bản ghi.",
    });
  }

  if (error.code === "P2003") {
    return res.status(409).json({
      message: "Thao tác vi phạm liên kết dữ liệu giữa các bảng.",
    });
  }

  if (error.code === "P2002") {
    return res.status(409).json({
      message: "Dữ liệu bị trùng. Tên đăng nhập có thể đã tồn tại.",
    });
  }

  if (error.status === 400) {
    return res.status(400).json({
      message: "Dữ liệu yêu cầu không hợp lệ.",
    });
  }

  if (error.status === 413) {
    return res.status(413).json({
      message: "Dữ liệu yêu cầu quá lớn.",
    });
  }

  console.error(error);

  res.status(500).json({
    message: "Lỗi hệ thống.",
  });
});

// ==================== KHỞI ĐỘNG VÀ DỪNG API ====================

let server;
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log("\nĐang dừng API...");

  const timeout = setTimeout(() => {
    process.exit(1);
  }, 10000);

  timeout.unref();

  if (server && server.listening) {
    await new Promise((resolve) => server.close(resolve));
  }

  await prisma.$disconnect();
  clearTimeout(timeout);
}

function handleShutdown() {
  shutdown().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);

async function start() {
  try {
    await prisma.$connect();

    server = app.listen(port);

    server.once("listening", () => {
      console.log(`API running at http://localhost:${port}`);
    });

    server.once("error", async (error) => {
      console.error("Không thể khởi động API:", error.message);
      process.exitCode = 1;
      await prisma.$disconnect();
    });
  } catch (error) {
    console.error("Không thể kết nối database:", error.message);
    process.exitCode = 1;
    await prisma.$disconnect();
  }
}

start();