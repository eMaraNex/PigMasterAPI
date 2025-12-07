import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import "express-async-errors";
import dotenv from "dotenv";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import logger from "./middleware/logger.js";
import rowsRoutes from "./routes/rows.routes.js";
import pensRoutes from "./routes/pens.routes.js";
import pigsRoutes from "./routes/pigs.routes.js";
import authRouter from "./routes/auth.routes.js";
import earningsRoutes from "./routes/earnings.routes.js";
import breedRoutes from "./routes/breed.routes.js";
import farmRoutes from "./routes/farms.routes.js";
import alertRoutes from "./routes/alerts.routes.js";
import healthRoutes from "./routes/health.routes.js";
import feedingRoutes from "./routes/feeding.routes.js";
import paymentRoutes from "./routes/payments.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { runSetUp } from "./database/runSetup.js";
import bodyParser from "body-parser";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// IMPORTANT: Trust proxy when deployed (Vercel, Heroku, AWS Lambda, etc.)
// This must be set BEFORE any rate limiting middleware
// Vercel automatically sets VERCEL=1 when deployed
if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1") {
  app.set("trust proxy", 1);
}

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Pig Farm Management API",
      version: "1.0.0.1",
      description: "Professional Pig Farm Management System API",
    },
    servers: [
      {
        url: process.env.PROD_BASE_URL || `http://localhost:${PORT}`,
        description: "Development server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  apis: ["./src/routes/*.js"],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Security middleware
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

app.use(
  cors({
    origin: [
      "https://pigmaster.emaranex.com",
      "http://localhost:3000",
      "https://pig-master-ui.vercel.app",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(bodyParser.json());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000,
  message: {
    error: "Too many requests from this IP, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", limiter);

// Body parsing middleware
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// API Documentation
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.post("/migrate", runSetUp);

// API Routes
const apiRouter = express.Router();

// Private Routes
apiRouter.use("/auth", authRouter);

// Public routes
apiRouter.use("/rows", rowsRoutes);
apiRouter.use("/pens", pensRoutes);
apiRouter.use("/pigs", pigsRoutes);
apiRouter.use("/earnings", earningsRoutes);
apiRouter.use("/breeds", breedRoutes);
apiRouter.use("/farms", farmRoutes);
apiRouter.use("/alerts", alertRoutes);
apiRouter.use("/health", healthRoutes);
apiRouter.use("/feeding", feedingRoutes);
apiRouter.use("/payments", paymentRoutes);

app.use("/api/v1", apiRouter);

// get homepage
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Welcome to Pig Farm Management API",
    documentation: "Visit /api-docs for API documentation",
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl,
  });
});

// error handling middleware
app.use((error, req, res, next) => {
  logger.error(error.message);
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message,
    errors: error.errors || [],
  });
});

// Global error handler
app.use(errorHandler);

// Initialize database and start server
async function startServer() {
  try {
    logger.info("Starting Pig Farm Management Server...");
    // Start server
    app.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`📚 API Documentation: http://localhost:${PORT}/api-docs`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

export default app;
