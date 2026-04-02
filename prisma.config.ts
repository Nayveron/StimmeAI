import { defineConfig } from "@prisma/config";
import * as dotenv from "dotenv";
import path from "path";

// 1. Явно подгружаем .env, указывая путь от корня
dotenv.config({ path: path.join(__dirname, ".env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // 2. Используем проверку на наличие, чтобы Prisma не ругалась на undefined
    url: process.env.DATABASE_URL || "",
    // @ts-ignore - убираем ошибку типов Prisma 7
    directUrl: process.env.DIRECT_URL || "",
  },
});