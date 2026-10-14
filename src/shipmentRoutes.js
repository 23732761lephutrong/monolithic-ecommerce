const express = require("express");

module.exports = function createShipmentRoutes(
  prisma,
  authenticate,
  requireAdmin
) {
  const router = express.Router();

  router.use(authenticate, requireAdmin);

  const statuses = ["PENDING", "SHIPPING", "DELIVERED", "FAILED"];

  function validateStatus(req, res, next) {
    const { status } = req.body || {};

    if (!statuses.includes(status)) {
      return res.status(400).json({
        message: "Trạng thái phải là PENDING, SHIPPING, DELIVERED hoặc FAILED.",
      });
    }

    next();
  }

  // Admin tạo vận chuyển cho đơn hàng.
  router.post("/", validateStatus, async (req, res) => {
    const { oid, status } = req.body;

    if (!Number.isInteger(oid) || oid <= 0 || oid > 2147483647) {
      return res.status(400).json({
        message: "Mã đơn hàng không hợp lệ.",
      });
    }

    const order = await prisma.order.findUnique({
      where: { oid },
    });

    if (!order) {
      return res.status(404).json({
        message: "Không tìm thấy đơn hàng.",
      });
    }

    const shipment = await prisma.shipment.create({
      data: { oid, status },
    });

    res.status(201).json({
      message: "Tạo vận chuyển thành công.",
      shipment,
    });
  });

  // Admin cập nhật trạng thái vận chuyển.
  router.patch("/:shipid", validateStatus, async (req, res) => {
    const shipid = Number(req.params.shipid);

    if (
      !Number.isInteger(shipid) ||
      shipid <= 0 ||
      shipid > 2147483647
    ) {
      return res.status(400).json({
        message: "Mã vận chuyển không hợp lệ.",
      });
    }

    const shipment = await prisma.shipment.update({
      where: { shipid },
      data: { status: req.body.status },
    });

    res.json({
      message: "Cập nhật vận chuyển thành công.",
      shipment,
    });
  });

  return router;
};
