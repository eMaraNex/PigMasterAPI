import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import "express-async-errors";
import dotenv from "dotenv";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import cron from "node-cron";
import logger from "./middleware/logger.js";
import authRouter from "./routes/auth.routes.js";
import currencyRoutes from "./routes/currency.routes.js";
import { apiBaseUrl } from "./config/urls.js";
import { processSubscriptionReminders } from "./services/subscription-reminders.service.js";
import paymentRoutes from "./routes/payments.routes.js";
import subscriptionRoutes from "./routes/subscriptions.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import { registerBusinessRoutes } from "./business/routing.js";
import PaymentService from "./services/payment.service.js";
import AlertService from "./services/alerts.services.js";
import { errorHandler } from "./middleware/errorHandler.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === "production";

// Trust the platform proxy so rate limits and audit logs see the real client IP.
// Set TRUST_PROXY=true when developing behind a tunnel such as ngrok.
if (isProduction || process.env.VERCEL === "1" || process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  })
);

const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
  : isProduction
    ? ["https://pigmaster.emaranex.com", "https://pigmaster.vercel.app"]
    : ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"];

app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Farm-Id"],
    exposedHeaders: ["Content-Disposition", "X-Export-Truncated"],
  })
);

app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use(
  "/api/",
  rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    limit: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000,
    message: { success: false, message: "Too many requests from this IP, please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// API documentation is only served outside production unless explicitly enabled.
if (!isProduction || process.env.ENABLE_API_DOCS === "true") {
  const swaggerSpec = swaggerJsdoc({
    definition: {
      openapi: "3.0.0",
      info: { title: "PigMaster API", version: "2.0.0", description: "Pig farm management API" },
      servers: [{ url: apiBaseUrl() }],
    },
    apis: ["./src/routes/*.js"],
  });
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

const apiRouter = express.Router();
apiRouter.use("/auth", authRouter);
apiRouter.use("/payments", paymentRoutes);
apiRouter.use("/subscriptions", subscriptionRoutes);
apiRouter.use("/currency", currencyRoutes);
apiRouter.use("/admin", adminRoutes);
// Farm data (farms, rows, pens, pigs, health, feeding, breeding, earnings, alerts...)
// and admin CRUD objects are generated from business/*-config.js.
registerBusinessRoutes(apiRouter);
app.use("/api/v1", apiRouter);

app.get("/", (_req, res) => {
  res.status(200).json({ success: true, message: "PigMaster API" });
});

app.use("*", (req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.use(errorHandler);

// Every schedule runs in UTC (servers are in Germany); user-facing times are converted where shown.
const UTC = { timezone: "UTC" };
const startSchedulers = () => {
  // Resolve M-Pesa payments whose callback never arrived; expire stale ones; recover late successes.
  cron.schedule("* * * * *", () => {
    PaymentService.reconcilePendingPayments().catch((error) =>
      logger.error(`Payment reconciliation failed: ${error.message}`)
    );
  }, UTC);
  // Email farm alerts that fall due today (farm timezone).
  cron.schedule("5 * * * *", () => {
    AlertService.processDueAlerts().catch((error) => logger.error(`Alert processing failed: ${error.message}`));
  }, UTC);
  // Trial / plan ending reminders once a day at 06:00 UTC (09:00 in Nairobi).
  cron.schedule("0 6 * * *", () => {
    processSubscriptionReminders().catch((error) => logger.error(`Subscription reminders failed: ${error.message}`));
  }, UTC);
};

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT} (${process.env.NODE_ENV})`);
    if (process.env.ENABLE_SCHEDULER !== "false") startSchedulers();
  });
}

export default app;
