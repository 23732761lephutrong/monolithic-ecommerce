const express = require("express");
const { Prisma } = require("@prisma/client");

module.exports = function createOrderRoutes(prisma, authenticate) {
  const router = express.Router();

  router.use(authenticate);

  const includeDetails = {
    orderDetails: {
      include: { product: true },
    },
    shipments: true,
  };

  function withTotal(order) {
    const total = order.orderDetails.reduce(
      (sum, detail) => sum.plus(detail.unit_price.mul(detail.qty)),
      new Prisma.Decimal(0)
    );

    return {
      ...order,
      total: total.toFixed(2),
    };
  }

  // Tạo đơn hàng.
  router.post("/", async (req, res, next) => {
    const { items } = req.body || {};

    if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
      return res.status(400).json({
        message: "Đơn hàng phải có từ 1 đến 50 sản phẩm.",
      });
    }

    const seen = new Set();

    for (const item of items) {
      if (
        !item ||
        !Number.isInteger(item.pid) ||
        item.pid <= 0 ||
        item.pid > 2147483647 ||
        !Number.isInteger(item.qty) ||
        item.qty <= 0 ||
        item.qty > 2147483647 ||
        seen.has(item.pid)
      ) {
        return res.status(400).json({
          message: "Mã, số lượng không hợp lệ hoặc sản phẩm bị trùng.",
        });
      }

      seen.add(item.pid);
    }

    const sortedItems = [...items].sort((a, b) => a.pid - b.pid);

    try {
      let order;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          order = await prisma.$transaction(
            async (tx) => {
              const details = [];

              for (const item of sortedItems) {
                const product = await tx.product.findUnique({
                  where: { pid: item.pid },
                });

                if (!product) {
                  const error = new Error(
                    `Không tìm thấy sản phẩm ${item.pid}.`
                  );
                  error.httpStatus = 404;
                  throw error;
                }

                const updated = await tx.product.updateMany({
                  where: {
                    pid: item.pid,
                    quantity: { gte: item.qty },
                  },
                  data: {
                    quantity: { decrement: item.qty },
                  },
                });

                if (updated.count !== 1) {
                  const error = new Error(
                    `Sản phẩm ${product.pname} không đủ tồn kho.`
                  );
                  error.httpStatus = 409;
                  throw error;
                }

                details.push({
                  pid: product.pid,
                  qty: item.qty,
                  unit_price: product.price,
                });
              }

              return tx.order.create({
                data: {
                  uid: req.user.uid,
                  orderDetails: { create: details },
                },
                include: includeDetails,
              });
            },
            {
              isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
              timeout: 15000,
            }
          );

          break;
        } catch (error) {
          if (error.code === "P2034" && attempt < 2) {
            continue;
          }

          throw error;
        }
      }

      res.status(201).json({
        message: "Đặt hàng thành công.",
        order: withTotal(order),
      });
    } catch (error) {
      if (error.httpStatus) {
        return res.status(error.httpStatus).json({
          message: error.message,
        });
      }

      if (error.code === "P2034") {
        return res.status(409).json({
          message: "Có giao dịch đồng thời. Vui lòng thử lại.",
        });
      }

      next(error);
    }
  });

  // Khách hàng xem đơn của mình; admin xem tất cả.
  router.get("/", async (req, res) => {
    const page = Number(req.query.page || 1);

    if (!Number.isInteger(page) || page < 1 || page > 1000000) {
      return res.status(400).json({
        message: "Số trang không hợp lệ.",
      });
    }

    const orders = await prisma.order.findMany({
      where:
        req.user.role.rolename === "ADMIN"
          ? {}
          : { uid: req.user.uid },
      orderBy: { oid: "desc" },
      skip: (page - 1) * 20,
      take: 20,
      include: includeDetails,
    });

    res.json({
      page,
      orders: orders.map(withTotal),
    });
  });

  // Xem chi tiết đơn hàng.
  router.get("/:oid", async (req, res) => {
    const oid = Number(req.params.oid);

    if (!Number.isInteger(oid) || oid <= 0 || oid > 2147483647) {
      return res.status(400).json({
        message: "Mã đơn hàng không hợp lệ.",
      });
    }

    const order = await prisma.order.findFirst({
      where: {
        oid,
        ...(req.user.role.rolename === "ADMIN"
          ? {}
          : { uid: req.user.uid }),
      },
      include: includeDetails,
    });

    if (!order) {
      return res.status(404).json({
        message: "Không tìm thấy đơn hàng trong quyền truy cập.",
      });
    }

    res.json({
      order: withTotal(order),
    });
  });

  return router;
};