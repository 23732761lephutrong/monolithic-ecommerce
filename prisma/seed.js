require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const adminRole = await prisma.role.upsert({
    where: { roleid: 1 },
    update: {},
    create: { roleid: 1, rolename: "ADMIN" },
  });

  await prisma.role.upsert({
    where: { roleid: 2 },
    update: {},
    create: { roleid: 2, rolename: "CUSTOMER" },
  });

  const membership = await prisma.memberShip.upsert({
    where: { mid: 1 },
    update: {},
    create: { mid: 1, mname: "STANDARD", score: 0 },
  });

  const passwordHash = await bcrypt.hash("Admin123!", 12);

  await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      fullname: "Quản trị viên",
      password: passwordHash,
      roleid: adminRole.roleid,
      mid: membership.mid,
    },
  });

  const products = [
    { pid: 1, pname: "Chuột không dây", price: "250000.00", quantity: 50 },
    { pid: 2, pname: "Bàn phím", price: "450000.00", quantity: 30 },
    { pid: 3, pname: "Tai nghe", price: "350000.00", quantity: 40 },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { pid: product.pid },
      update: {},
      create: product,
    });
  }

  // Đồng bộ bộ đếm ID sau khi thêm dữ liệu có ID cố định.
  await prisma.$executeRaw`
    SELECT setval(
      pg_get_serial_sequence('"Role"', 'roleid'),
      (SELECT MAX(roleid) FROM "Role"),
      true
    )
  `;

  await prisma.$executeRaw`
    SELECT setval(
      pg_get_serial_sequence('"MemberShip"', 'mid'),
      (SELECT MAX(mid) FROM "MemberShip"),
      true
    )
  `;

  await prisma.$executeRaw`
    SELECT setval(
      pg_get_serial_sequence('"Product"', 'pid'),
      (SELECT MAX(pid) FROM "Product"),
      true
    )
  `;

  console.log("Seed thành công.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });