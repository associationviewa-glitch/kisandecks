import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertBookingSchema, loginSchema, insertExpertSchema, advisoryQuerySchema, visionAdvisorySchema, farmerLoginSchema, farmerRegisterSchema } from "@shared/schema";
import crypto from "crypto";
import { fromError } from "zod-validation-error";
import bcrypt from "bcrypt";
import OpenAI from "openai";
import { getLiveDataContext, refreshAllData, fetchMandiPrices } from "./data-ingestion";
import { generateMarketPrices, getStatesWithMarkets, getCommodityCategories, getDistrictsForState, getMarketsForState, allCommodities } from "./marketData";
import multer from "multer";
import path from "path";
import fs from "fs";

// Configure multer for image uploads
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const multerStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: multerStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG and WebP images are allowed"));
    }
  },
});

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
// This is using Replit's AI Integrations service, which provides OpenAI-compatible API access without requiring your own OpenAI API key.
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY
});

declare module "express-session" {
  interface SessionData {
    adminId?: number;
    expertId?: number;
    farmerId?: number;
  }
}

// Middleware to check admin authentication
const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session?.adminId) {
    return res.status(401).json({ error: "Admin authentication required" });
  }
  next();
};

// Middleware to check expert authentication
const requireExpert = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session?.expertId) {
    return res.status(401).json({ error: "Expert authentication required" });
  }
  next();
};

// Middleware to check farmer authentication (for learning module)
const requireFarmer = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session?.farmerId) {
    return res.status(401).json({ 
      error: "Authentication required",
      message: "Please login to access learning content",
      messageHindi: "कृपया सीखने की सामग्री तक पहुंचने के लिए लॉगिन करें"
    });
  }
  next();
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // ========== AUTH ROUTES ==========
  
  // Admin login
  app.post("/api/admin/login", async (req, res) => {
    try {
      const { username, password } = loginSchema.parse(req.body);
      const admin = await storage.getAdminByUsername(username);
      
      if (!admin) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      
      // Check password (support both hashed and plain for migration)
      const isValidPassword = admin.password.startsWith('$2') 
        ? await bcrypt.compare(password, admin.password)
        : admin.password === password;
      
      if (!isValidPassword) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      
      req.session.adminId = admin.id;
      res.json({ id: admin.id, name: admin.name, username: admin.username });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: fromError(error).toString() });
      }
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Admin logout
  app.post("/api/admin/logout", (req, res) => {
    req.session.destroy((err: Error | null) => {
      if (err) return res.status(500).json({ error: "Logout failed" });
      res.json({ message: "Logged out" });
    });
  });

  // Admin session check
  app.get("/api/admin/me", async (req, res) => {
    const adminId = req.session?.adminId;
    if (!adminId) return res.status(401).json({ error: "Not authenticated" });
    
    const admin = await storage.getAdminById(adminId);
    if (!admin) return res.status(401).json({ error: "Admin not found" });
    
    res.json({ id: admin.id, name: admin.name, username: admin.username });
  });

  // Expert login
  app.post("/api/expert/login", async (req, res) => {
    try {
      const { username, password } = loginSchema.parse(req.body);
      const expert = await storage.getExpertByUsername(username);
      
      if (!expert) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      
      // Check password (support both hashed and plain for migration)
      const isValidPassword = expert.password.startsWith('$2') 
        ? await bcrypt.compare(password, expert.password)
        : expert.password === password;
      
      if (!isValidPassword) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      
      if (!expert.isActive) {
        return res.status(403).json({ error: "Account is disabled" });
      }
      
      if (expert.status !== "approved") {
        return res.status(403).json({ error: "Account is not approved" });
      }
      
      req.session.expertId = expert.id;
      res.json({ id: expert.id, name: expert.name, username: expert.username, category: expert.category });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: fromError(error).toString() });
      }
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Expert logout
  app.post("/api/expert/logout", (req, res) => {
    req.session.destroy((err: Error | null) => {
      if (err) return res.status(500).json({ error: "Logout failed" });
      res.json({ message: "Logged out" });
    });
  });

  // Expert session check
  app.get("/api/expert/me", async (req, res) => {
    const expertId = req.session?.expertId;
    if (!expertId) return res.status(401).json({ error: "Not authenticated" });
    
    const expert = await storage.getExpertById(expertId);
    if (!expert) return res.status(401).json({ error: "Expert not found" });
    
    res.json({ id: expert.id, name: expert.name, username: expert.username, category: expert.category, phone: expert.phone });
  });

  // ========== FARMER AUTH ROUTES (for Learning Module) ==========
  
  // Farmer registration
  app.post("/api/farmer/register", async (req, res) => {
    try {
      const data = farmerRegisterSchema.parse(req.body);
      
      // Check if phone already exists
      const existing = await storage.getFarmerByPhone(data.phone);
      if (existing) {
        return res.status(400).json({ 
          error: "Phone number already registered",
          errorHindi: "यह फोन नंबर पहले से पंजीकृत है"
        });
      }
      
      // Hash password
      const hashedPassword = await bcrypt.hash(data.password, 10);
      
      const farmer = await storage.createFarmer({
        phone: data.phone,
        password: hashedPassword,
        name: data.name,
        village: data.village,
        district: data.district,
        state: data.state,
        language: data.language || "hindi",
      });
      
      req.session.farmerId = farmer.id;
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ error: "Session error" });
        }
        res.status(201).json({ 
          success: true,
          farmer: { id: farmer.id, name: farmer.name, phone: farmer.phone, language: farmer.language }
        });
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: fromError(error).toString() });
      }
      console.error("Farmer registration error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  // Farmer login
  app.post("/api/farmer/login", async (req, res) => {
    try {
      const { phone, password } = farmerLoginSchema.parse(req.body);
      
      const farmer = await storage.getFarmerByPhone(phone);
      if (!farmer) {
        return res.status(401).json({ 
          error: "Invalid phone or password",
          errorHindi: "गलत फोन नंबर या पासवर्ड"
        });
      }
      
      const isValidPassword = await bcrypt.compare(password, farmer.password);
      if (!isValidPassword) {
        return res.status(401).json({ 
          error: "Invalid phone or password",
          errorHindi: "गलत फोन नंबर या पासवर्ड"
        });
      }
      
      if (!farmer.isActive) {
        return res.status(403).json({ error: "Account is disabled" });
      }
      
      // Update last login
      await storage.updateFarmerLastLogin(farmer.id);
      
      req.session.farmerId = farmer.id;
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ error: "Session error" });
        }
        res.json({ 
          success: true,
          farmer: { id: farmer.id, name: farmer.name, phone: farmer.phone, language: farmer.language }
        });
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: fromError(error).toString() });
      }
      console.error("Farmer login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Farmer logout
  app.post("/api/farmer/logout", (req, res) => {
    req.session.farmerId = undefined;
    res.json({ success: true, message: "Logged out" });
  });

  // Farmer session check
  app.get("/api/farmer/me", async (req, res) => {
    const farmerId = req.session?.farmerId;
    if (!farmerId) {
      return res.status(401).json({ 
        authenticated: false,
        message: "Not logged in",
        messageHindi: "लॉगिन नहीं है"
      });
    }
    
    const farmer = await storage.getFarmerById(farmerId);
    if (!farmer) {
      return res.status(401).json({ authenticated: false, error: "Farmer not found" });
    }
    
    res.json({ 
      authenticated: true,
      farmer: { 
        id: farmer.id, 
        name: farmer.name, 
        phone: farmer.phone, 
        village: farmer.village,
        district: farmer.district,
        state: farmer.state,
        language: farmer.language,
        crops: farmer.crops,
        profilePhoto: farmer.profilePhoto
      }
    });
  });

  // Farmer profile photo upload
  app.post("/api/farmer/profile-photo", upload.single("photo"), async (req, res) => {
    const farmerId = req.session?.farmerId;
    if (!farmerId) {
      return res.status(401).json({ error: "Not logged in" });
    }
    
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No photo uploaded" });
      }
      
      const photoPath = `/uploads/${req.file.filename}`;
      await storage.updateFarmerProfile(farmerId, { profilePhoto: photoPath });
      
      res.json({ success: true, profilePhoto: photoPath });
    } catch (error) {
      console.error("Profile photo upload error:", error);
      res.status(500).json({ error: "Failed to upload profile photo" });
    }
  });

  // Farmer profile update
  app.put("/api/farmer/profile", async (req, res) => {
    const farmerId = req.session?.farmerId;
    if (!farmerId) {
      return res.status(401).json({ error: "Not logged in" });
    }
    
    try {
      const { name, email, village, district, state, language } = req.body;
      
      await storage.updateFarmerProfile(farmerId, {
        name,
        email,
        village,
        district,
        state,
        language
      });
      
      res.json({ success: true, message: "Profile updated" });
    } catch (error) {
      console.error("Profile update error:", error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  // Farmer account delete (Google Play mandatory)
  app.delete("/api/farmer/delete", async (req, res) => {
    const farmerId = req.session?.farmerId;
    if (!farmerId) {
      return res.status(401).json({ error: "Not logged in" });
    }
    
    try {
      await storage.deleteFarmer(farmerId);
      req.session.farmerId = undefined;
      res.json({ success: true, message: "Account deleted" });
    } catch (error) {
      console.error("Account delete error:", error);
      res.status(500).json({ error: "Failed to delete account" });
    }
  });

  // ========== OTP ROUTES ==========
  
  // In-memory OTP store (in production, use Redis or database)
  const otpStore = new Map<string, { otp: string; expiresAt: Date; verified: boolean }>();
  // Separate store for login OTPs
  const loginOtpStore = new Map<string, { otp: string; expiresAt: Date }>();
  
  // Send OTP for login
  app.post("/api/farmer/login/send-otp", async (req, res) => {
    try {
      const { phone } = req.body;
      
      if (!phone || !/^[6-9]\d{9}$/.test(phone)) {
        return res.status(400).json({ 
          error: "Invalid phone number",
          errorHindi: "गलत मोबाइल नंबर"
        });
      }
      
      // Check if farmer exists
      const farmer = await storage.getFarmerByPhone(phone);
      if (!farmer) {
        return res.status(404).json({ 
          error: "No account found with this number. Please register first.",
          errorHindi: "इस नंबर से कोई खाता नहीं मिला। पहले रजिस्टर करें।"
        });
      }
      
      // Generate 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      
      // Store OTP for login
      loginOtpStore.set(phone, { otp, expiresAt });
      
      // In production, send SMS via Twilio
      console.log(`[DEV] Login OTP for ${phone}: ${otp}`);
      
      res.json({ 
        success: true,
        message: "OTP sent to your mobile",
        messageHindi: "OTP आपके मोबाइल पर भेजा गया",
        // In development, include OTP for testing
        ...(process.env.NODE_ENV !== "production" && { devOtp: otp })
      });
    } catch (error: any) {
      console.error("Send login OTP error:", error);
      res.status(500).json({ error: "Failed to send OTP" });
    }
  });
  
  // Verify OTP for login
  app.post("/api/farmer/login/verify-otp", async (req, res) => {
    try {
      const { phone, otp } = req.body;
      
      if (!phone || !otp) {
        return res.status(400).json({ error: "Phone and OTP required" });
      }
      
      const storedData = loginOtpStore.get(phone);
      
      if (!storedData) {
        return res.status(400).json({ 
          error: "No OTP found. Please request a new one.",
          errorHindi: "कोई OTP नहीं मिला। नया OTP भेजें।"
        });
      }
      
      if (new Date() > storedData.expiresAt) {
        loginOtpStore.delete(phone);
        return res.status(400).json({ 
          error: "OTP expired. Please request a new one.",
          errorHindi: "OTP समाप्त हो गया। नया OTP भेजें।"
        });
      }
      
      if (storedData.otp !== otp) {
        return res.status(400).json({ 
          error: "Invalid OTP",
          errorHindi: "गलत OTP"
        });
      }
      
      // OTP verified, log in the user
      const farmer = await storage.getFarmerByPhone(phone);
      if (!farmer) {
        return res.status(404).json({ error: "Farmer not found" });
      }
      
      if (!farmer.isActive) {
        return res.status(403).json({ error: "Account is disabled" });
      }
      
      // Update last login
      await storage.updateFarmerLastLogin(farmer.id);
      
      // Clear used OTP
      loginOtpStore.delete(phone);
      
      req.session.farmerId = farmer.id;
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ error: "Session error" });
        }
        res.json({ 
          success: true,
          farmer: { id: farmer.id, name: farmer.name, phone: farmer.phone, language: farmer.language }
        });
      });
    } catch (error: any) {
      console.error("Verify login OTP error:", error);
      res.status(500).json({ error: "OTP verification failed" });
    }
  });
  
  // Send OTP for password reset
  app.post("/api/farmer/forgot-password/send-otp", async (req, res) => {
    try {
      const { phone } = req.body;
      
      if (!phone || !/^[6-9]\d{9}$/.test(phone)) {
        return res.status(400).json({ 
          error: "Invalid phone number",
          errorHindi: "गलत मोबाइल नंबर"
        });
      }
      
      // Check if farmer exists
      const farmer = await storage.getFarmerByPhone(phone);
      if (!farmer) {
        return res.status(404).json({ 
          error: "No account found with this number",
          errorHindi: "इस नंबर से कोई खाता नहीं मिला"
        });
      }
      
      // Generate 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      
      // Store OTP
      otpStore.set(phone, { otp, expiresAt, verified: false });
      
      // In production, send SMS via Twilio
      // For now, we'll log it and show it in development
      console.log(`[DEV] OTP for ${phone}: ${otp}`);
      
      res.json({ 
        success: true,
        message: "OTP sent to your mobile",
        messageHindi: "OTP आपके मोबाइल पर भेजा गया",
        // In development, include OTP for testing
        ...(process.env.NODE_ENV !== "production" && { devOtp: otp })
      });
    } catch (error: any) {
      console.error("Send OTP error:", error);
      res.status(500).json({ error: "Failed to send OTP" });
    }
  });
  
  // Verify OTP
  app.post("/api/farmer/forgot-password/verify-otp", async (req, res) => {
    try {
      const { phone, otp } = req.body;
      
      if (!phone || !otp) {
        return res.status(400).json({ error: "Phone and OTP required" });
      }
      
      const storedData = otpStore.get(phone);
      
      if (!storedData) {
        return res.status(400).json({ 
          error: "OTP expired or not found",
          errorHindi: "OTP समाप्त हो गया या नहीं मिला"
        });
      }
      
      if (new Date() > storedData.expiresAt) {
        otpStore.delete(phone);
        return res.status(400).json({ 
          error: "OTP expired",
          errorHindi: "OTP समाप्त हो गया"
        });
      }
      
      if (storedData.otp !== otp) {
        return res.status(400).json({ 
          error: "Invalid OTP",
          errorHindi: "गलत OTP"
        });
      }
      
      // Mark OTP as verified
      otpStore.set(phone, { ...storedData, verified: true });
      
      res.json({ 
        success: true,
        message: "OTP verified",
        messageHindi: "OTP सत्यापित"
      });
    } catch (error: any) {
      console.error("Verify OTP error:", error);
      res.status(500).json({ error: "Failed to verify OTP" });
    }
  });
  
  // Reset password
  app.post("/api/farmer/forgot-password/reset", async (req, res) => {
    try {
      const { phone, otp, newPassword } = req.body;
      
      if (!phone || !otp || !newPassword) {
        return res.status(400).json({ error: "Phone, OTP and new password required" });
      }
      
      if (newPassword.length < 8) {
        return res.status(400).json({ 
          error: "Password must be at least 8 characters",
          errorHindi: "पासवर्ड कम से कम 8 अक्षर का होना चाहिए"
        });
      }
      
      const storedData = otpStore.get(phone);
      
      if (!storedData || !storedData.verified) {
        return res.status(400).json({ 
          error: "Please verify OTP first",
          errorHindi: "पहले OTP सत्यापित करें"
        });
      }
      
      if (storedData.otp !== otp) {
        return res.status(400).json({ 
          error: "Invalid OTP",
          errorHindi: "गलत OTP"
        });
      }
      
      // Get farmer
      const farmer = await storage.getFarmerByPhone(phone);
      if (!farmer) {
        return res.status(404).json({ error: "Farmer not found" });
      }
      
      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      
      // Update password
      await storage.updateFarmerPassword(farmer.id, hashedPassword);
      
      // Clear OTP
      otpStore.delete(phone);
      
      res.json({ 
        success: true,
        message: "Password reset successful",
        messageHindi: "पासवर्ड सफलतापूर्वक बदल गया"
      });
    } catch (error: any) {
      console.error("Reset password error:", error);
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // ========== ADMIN ROUTES ==========
  
  // Get all experts (admin only)
  app.get("/api/admin/experts", requireAdmin, async (req, res) => {
    try {
      const allExperts = await storage.getAllExperts();
      res.json(allExperts.map(e => ({ ...e, password: undefined })));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch experts" });
    }
  });

  // Create new expert (admin only)
  app.post("/api/admin/experts", requireAdmin, async (req, res) => {
    try {
      const expertData = insertExpertSchema.parse(req.body);
      // Hash password before storing
      const hashedPassword = await bcrypt.hash(expertData.password, 10);
      const expert = await storage.createExpert({ ...expertData, password: hashedPassword });
      res.status(201).json({ ...expert, password: undefined });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: fromError(error).toString() });
      }
      if (error.message?.includes("unique")) {
        return res.status(400).json({ error: "Username already exists" });
      }
      res.status(500).json({ error: "Failed to create expert" });
    }
  });

  // Update expert status (approve/reject)
  app.patch("/api/admin/experts/:id/status", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      if (!["pending", "approved", "rejected"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      
      const expert = await storage.updateExpertStatus(parseInt(id), status);
      if (!expert) return res.status(404).json({ error: "Expert not found" });
      
      res.json({ ...expert, password: undefined });
    } catch (error) {
      res.status(500).json({ error: "Failed to update status" });
    }
  });

  // Toggle expert active status
  app.patch("/api/admin/experts/:id/active", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      
      const expert = await storage.updateExpertActive(parseInt(id), isActive);
      if (!expert) return res.status(404).json({ error: "Expert not found" });
      
      res.json({ ...expert, password: undefined });
    } catch (error) {
      res.status(500).json({ error: "Failed to update active status" });
    }
  });

  // Reset expert password
  app.patch("/api/admin/experts/:id/password", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { password } = req.body;
      
      if (!password || password.length < 4) {
        return res.status(400).json({ error: "Password must be at least 4 characters" });
      }
      
      // Hash password before storing
      const hashedPassword = await bcrypt.hash(password, 10);
      const expert = await storage.updateExpertPassword(parseInt(id), hashedPassword);
      if (!expert) return res.status(404).json({ error: "Expert not found" });
      
      res.json({ message: "Password updated" });
    } catch (error) {
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // Delete expert
  app.delete("/api/admin/experts/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteExpert(parseInt(id));
      res.json({ message: "Expert deleted" });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete expert" });
    }
  });

  // Assign expert to booking
  app.patch("/api/admin/bookings/:id/assign", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { expertId } = req.body;
      
      const booking = await storage.assignExpertToBooking(parseInt(id), expertId);
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      
      res.json(booking);
    } catch (error) {
      res.status(500).json({ error: "Failed to assign expert" });
    }
  });

  // Get all bookings with expert info (admin only)
  app.get("/api/admin/bookings", requireAdmin, async (req, res) => {
    try {
      const allBookings = await storage.getAllBookings();
      const allExperts = await storage.getAllExperts();
      
      const bookingsWithExperts = allBookings.map(booking => ({
        ...booking,
        expert: booking.expertId ? allExperts.find(e => e.id === booking.expertId) : null
      }));
      
      res.json(bookingsWithExperts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch bookings" });
    }
  });

  // ========== EXPERT ROUTES ==========
  
  // Get expert's assigned bookings
  app.get("/api/expert/bookings", requireExpert, async (req, res) => {
    try {
      const expertId = req.session.expertId!;
      const bookings = await storage.getBookingsByExpertId(expertId);
      res.json(bookings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch bookings" });
    }
  });

  // Update booking session status (expert only)
  app.patch("/api/expert/bookings/:id/status", requireExpert, async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const expertId = req.session.expertId!;
      
      if (!["assigned", "in-progress", "completed"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      
      // Verify booking belongs to this expert
      const booking = await storage.getBookingById(parseInt(id));
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      if (booking.expertId !== expertId) {
        return res.status(403).json({ error: "Not your booking" });
      }
      
      const updated = await storage.updateBookingSessionStatus(parseInt(id), status);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update status" });
    }
  });

  // ========== PUBLIC BOOKING ROUTES ==========
  
  // Create a new booking
  app.post("/api/bookings", async (req, res) => {
    try {
      const validatedData = insertBookingSchema.parse(req.body);
      const booking = await storage.createBooking(validatedData);
      res.status(201).json(booking);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        const validationError = fromError(error);
        return res.status(400).json({ error: validationError.toString() });
      }
      console.error("Error creating booking:", error);
      res.status(500).json({ error: "Failed to create booking" });
    }
  });

  // Get all bookings (public for history)
  app.get("/api/bookings", async (req, res) => {
    try {
      const allBookings = await storage.getAllBookings();
      res.json(allBookings);
    } catch (error) {
      console.error("Error fetching bookings:", error);
      res.status(500).json({ error: "Failed to fetch bookings" });
    }
  });

  // Get booking by session ID
  app.get("/api/bookings/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const booking = await storage.getBookingBySessionId(sessionId);
      
      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }
      
      res.json(booking);
    } catch (error) {
      console.error("Error fetching booking:", error);
      res.status(500).json({ error: "Failed to fetch booking" });
    }
  });

  // Update booking payment status (confirm payment)
  app.patch("/api/bookings/:sessionId/payment", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { status } = req.body;
      
      if (!["PENDING", "PAID", "FAILED"].includes(status)) {
        return res.status(400).json({ error: "Invalid payment status" });
      }
      
      const booking = await storage.updateBookingPaymentStatus(sessionId, status);
      
      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }
      
      res.json(booking);
    } catch (error) {
      console.error("Error updating payment status:", error);
      res.status(500).json({ error: "Failed to update payment status" });
    }
  });

  // ========== AI ADVISORY ROUTES ==========
  
  // Refresh live data (admin only)
  app.post("/api/advisory/refresh-data", requireAdmin, async (req, res) => {
    try {
      console.log("Manual data refresh triggered by admin");
      await refreshAllData();
      res.json({ message: "Data refresh completed" });
    } catch (error) {
      console.error("Error refreshing data:", error);
      res.status(500).json({ error: "Failed to refresh data" });
    }
  });

  // Fetch prices for specific commodity
  app.get("/api/prices/:commodity", async (req, res) => {
    try {
      const { commodity } = req.params;
      const prices = await storage.getMarketPricesByCommodity(commodity);
      res.json(prices);
    } catch (error) {
      console.error("Error fetching prices:", error);
      res.status(500).json({ error: "Failed to fetch prices" });
    }
  });

  // Get chat history for a session
  app.get("/api/advisory/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const chats = await storage.getAdvisoryChatsBySession(sessionId);
      res.json(chats);
    } catch (error) {
      console.error("Error fetching advisory chats:", error);
      res.status(500).json({ error: "Failed to fetch chat history" });
    }
  });

  // Send message and get AI response
  app.post("/api/advisory", async (req, res) => {
    try {
      const validatedData = advisoryQuerySchema.parse(req.body);
      const { sessionId, message, category, advisoryType } = validatedData;
      
      // Save user message
      await storage.createAdvisoryChat({
        sessionId,
        role: "user",
        content: message,
        category: category || null,
        imageUrl: null,
      });
      
      // Get chat history for context
      const history = await storage.getAdvisoryChatsBySession(sessionId);
      
      // Get live data context from database (for crop, fruits, and general modes)
      const liveDataContext = (advisoryType === "crop" || advisoryType === "fruits" || !advisoryType) 
        ? await getLiveDataContext(message) 
        : "";
      
      // Build messages array for OpenAI
      const currentDate = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      
      // Build system prompt based on advisory type
      let systemMessage: string;
      
      switch (advisoryType) {
        case "cattle":
          systemMessage = `You are KisanDecks Cattle Care Advisory, an expert veterinary consultant for Indian farmers. Today's date is ${currentDate}.

You provide helpful advice on:
- Cattle health and disease management
- Dairy farming and milk production
- Feed and nutrition for livestock
- Breeding and reproduction
- Common cattle diseases and their treatment
- Vaccination schedules
- Goat, buffalo, and other livestock care

CATTLE CARE GUIDANCE:
Common cattle diseases in India and treatments:
- Foot and Mouth Disease (FMD): Vaccinate every 6 months, isolate infected animals
- Mastitis: Maintain hygiene, proper milking technique, antibiotic treatment
- Bloat: Emergency - use trocar, vegetable oil, walking the animal
- Tick fever (Babesiosis): Anti-parasitic treatment, tick control
- Black Quarter: Vaccination, immediate antibiotic treatment
- Hemorrhagic Septicemia: Pre-monsoon vaccination essential

Milk production tips:
- Feed balanced diet with green fodder, dry fodder, and concentrates
- Provide clean water 3-4 times daily
- Maintain proper shelter and ventilation
- Regular deworming every 3 months
- Proper milking hygiene

Important: For serious conditions, always recommend consulting a local veterinarian.

Always respond in a friendly, helpful manner. Keep answers practical and specific to Indian farming conditions. You can respond in Hindi if the user messages in Hindi.`;
          break;
          
        case "soil":
          systemMessage = `You are KisanDecks Soil Care Advisory, an expert soil scientist for Indian farmers. Today's date is ${currentDate}.

You provide helpful advice on:
- Soil testing and analysis
- Soil pH management
- Organic and chemical fertilizers
- Soil health improvement
- Composting and manure management
- Soil erosion prevention

SOIL CARE GUIDANCE:
Ideal soil conditions for major crops:
- Rice: pH 5.5-6.5, clayey soil with good water retention
- Wheat: pH 6.0-7.5, loamy soil with good drainage
- Cotton: pH 6.0-8.0, black cotton soil (vertisol)
- Sugarcane: pH 6.0-7.5, deep loamy soil

Organic soil improvement:
- Green manure crops: Dhaincha, Sunhemp, Sesbania
- Vermicompost: 2-3 tonnes per acre
- FYM (Farmyard Manure): 8-10 tonnes per acre
- Crop residue incorporation

Soil testing:
- Test soil every 2-3 years
- Best time: After harvest, before sowing
- Get tests from Krishi Vigyan Kendra or soil testing labs

Always respond in a friendly, helpful manner. Keep answers practical for Indian conditions. You can respond in Hindi if the user messages in Hindi.`;
          break;
          
        case "water":
          systemMessage = `You are KisanDecks Water & Irrigation Advisory, an expert irrigation specialist for Indian farmers. Today's date is ${currentDate}.

You provide helpful advice on:
- Irrigation scheduling and methods
- Drip and sprinkler irrigation
- Water conservation techniques
- Rainwater harvesting
- Groundwater management
- Flood and drought management

IRRIGATION GUIDANCE:
Irrigation methods and efficiency:
- Flood irrigation: 30-40% efficiency
- Furrow irrigation: 50-60% efficiency
- Sprinkler: 70-80% efficiency
- Drip irrigation: 90-95% efficiency

Water requirements (approximate):
- Rice: 1200-1500 mm per season
- Wheat: 400-500 mm per season
- Cotton: 700-900 mm per season
- Vegetables: 400-600 mm per season

Water saving tips:
- Mulching reduces evaporation by 25-30%
- Alternate wetting and drying (AWD) for rice
- Schedule irrigation early morning or evening
- Use tensiometer or soil moisture sensors
- Rainwater harvesting: 1 mm rain = 10,000 liters per hectare

Government schemes: PM Krishi Sinchayee Yojana provides subsidy for micro-irrigation.

Always respond in a friendly, helpful manner. Keep answers practical for Indian conditions. You can respond in Hindi if the user messages in Hindi.`;
          break;
          
        case "fruits":
          systemMessage = `You are KisanDecks Fruits & Vegetables Advisory, an expert horticulturist for Indian farmers. Today's date is ${currentDate}.

You provide helpful advice on:
- Fruit tree cultivation and care
- Vegetable farming techniques
- Pest and disease management
- Harvesting and post-harvest handling
- Market timing and pricing
- Organic fruit and vegetable growing

FRUITS & VEGETABLES GUIDANCE:
Popular fruits in India:
- Mango: Plant June-July, harvest April-June
- Banana: Year-round planting, 12-14 months to harvest
- Guava: Plant July-August, fruits in 2-3 years
- Papaya: Quick returns, fruits in 10-12 months
- Citrus: Best planted in monsoon

Vegetable seasons:
- Kharif (Monsoon): Okra, brinjal, chilli, tomato
- Rabi (Winter): Cauliflower, cabbage, peas, potato
- Zaid (Summer): Cucumber, watermelon, muskmelon

Organic pest control:
- Neem oil spray for aphids and whiteflies
- Pheromone traps for fruit flies
- Trichoderma for soil-borne diseases
- Companion planting: Marigold with vegetables

${liveDataContext ? `\n--- LIVE DATA FROM OFFICIAL SOURCES ---${liveDataContext}\n--- END LIVE DATA ---` : ''}

Always respond in a friendly, helpful manner. Keep answers practical for Indian conditions. You can respond in Hindi if the user messages in Hindi.`;
          break;
          
        default: // crop or general
          systemMessage = `You are KisanDecks Crop Doctor, an expert agricultural consultant for Indian farmers. Today's date is ${currentDate}.

You provide helpful advice on:
- Crop management and farming techniques
- Soil health and fertility  
- Pest and disease control
- Irrigation and water management
- Market prices and selling strategies

MARKET PRICE GUIDANCE (December 2024 Reference Rates):
Common crop prices in Indian mandis (₹ per quintal):
- Wheat: ₹2,200 - ₹2,600 (MSP: ₹2,275)
- Rice (Paddy): ₹2,100 - ₹2,400 (MSP: ₹2,300)
- Onion: ₹1,500 - ₹4,000 (highly variable)
- Potato: ₹800 - ₹1,800
- Tomato: ₹1,000 - ₹3,500 (seasonal)
- Soybean: ₹4,200 - ₹4,800
- Cotton: ₹6,500 - ₹7,200
- Sugarcane: ₹350 - ₹400 (FRP: ₹340)
- Maize: ₹1,800 - ₹2,200
- Mustard: ₹5,000 - ₹5,800

When asked about prices:
1. If LIVE MANDI PRICES data is provided below, use those exact prices first
2. Otherwise, use the reference ranges above as estimates
3. Always mention if prices are from live data or estimates
4. Direct users to agmarknet.gov.in or enam.gov.in for more details
5. Give practical selling tips

${liveDataContext ? `\n--- LIVE DATA FROM OFFICIAL SOURCES ---${liveDataContext}\n--- END LIVE DATA ---` : ''}

Always respond in a friendly, helpful manner. Keep answers concise. You can respond in Hindi if the user messages in Hindi.`;
      }

      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: systemMessage },
      ];
      
      // Add recent history (last 10 messages for context)
      const recentHistory = history.slice(-10);
      for (const chat of recentHistory) {
        messages.push({
          role: chat.role as "user" | "assistant",
          content: chat.content,
        });
      }
      
      // Call OpenAI with gpt-4.1 (latest model with best capabilities)
      let aiResponse = "Sorry, I could not generate a response. Please try again.";
      try {
        console.log("Calling OpenAI with messages:", JSON.stringify(messages.slice(0, 2)));
        const completion = await openai.chat.completions.create({
          model: "gpt-4.1", // Using gpt-4.1 - latest and most capable model
          messages,
          max_tokens: 1024,
        });
        console.log("OpenAI response received:", completion.choices[0]?.message?.content?.slice(0, 100));
        aiResponse = completion.choices[0]?.message?.content || aiResponse;
      } catch (aiError: any) {
        console.error("OpenAI API error:", aiError.message, aiError.status, aiError.code);
        throw aiError;
      }
      
      // Save AI response
      const savedResponse = await storage.createAdvisoryChat({
        sessionId,
        role: "assistant",
        content: aiResponse,
        category: category || null,
        imageUrl: null,
      });
      
      res.json(savedResponse);
    } catch (error: any) {
      console.error("Error in AI advisory:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: fromError(error).toString() });
      }
      res.status(500).json({ error: "Failed to get AI response" });
    }
  });

  // Vision-based crop disease diagnosis
  app.post("/api/advisory/vision", upload.single("image"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No image uploaded" });
      }

      const { sessionId, message, advisoryType } = req.body;
      if (!sessionId) {
        return res.status(400).json({ error: "Session ID is required" });
      }

      // Read image as base64
      const imageBuffer = fs.readFileSync(file.path);
      const base64Image = imageBuffer.toString("base64");
      const mimeType = file.mimetype;

      // Save user message with image
      await storage.createAdvisoryChat({
        sessionId,
        role: "user",
        content: message || (advisoryType === "cattle" ? "Please diagnose this animal's condition" : "Please diagnose this crop disease"),
        category: null,
        imageUrl: `/uploads/${file.filename}`,
      });

      // Build vision prompt based on advisory type
      const systemPrompt = advisoryType === "cattle" 
        ? `You are an expert veterinary consultant for Indian farmers. Analyze the image of the animal provided and:
1. Identify any visible health issues, diseases, or abnormalities
2. Provide a diagnosis with confidence level
3. Suggest immediate treatment options
4. Recommend preventive measures
5. Advise when to consult a veterinarian in person

Focus on common cattle/livestock diseases in Indian farming conditions. Be specific and practical.`
        : `You are an expert agricultural consultant specializing in crop disease diagnosis for Indian farmers. Analyze the image of the crop/plant provided and:
1. Identify the crop/plant if possible
2. Diagnose any visible diseases, pest damage, or nutrient deficiencies
3. Provide a confidence level for your diagnosis
4. Suggest immediate treatment options (organic and chemical)
5. Recommend preventive measures for the future

Focus on common crop diseases in Indian farming conditions. Be specific and practical.`;

      // Call OpenAI Vision API
      const completion = await openai.chat.completions.create({
        model: "gpt-4.1", // Using latest model with vision capabilities
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: message || "Please analyze this image and provide diagnosis" },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        max_tokens: 1500,
      });

      const aiResponse = completion.choices[0]?.message?.content || "Sorry, I could not analyze the image. Please try again.";

      // Save AI response
      const savedResponse = await storage.createAdvisoryChat({
        sessionId,
        role: "assistant",
        content: aiResponse,
        category: null,
        imageUrl: null,
      });

      // Clean up uploaded file after processing (optional - keep for history)
      // fs.unlinkSync(file.path);

      res.json(savedResponse);
    } catch (error: any) {
      console.error("Error in vision advisory:", error);
      res.status(500).json({ error: "Failed to analyze image" });
    }
  });

  // Serve uploaded images
  app.use("/uploads", (req, res, next) => {
    const filePath = path.join(uploadDir, req.path);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: "Image not found" });
    }
  });

  // ========== LOCATION AUTOCOMPLETE API ==========
  
  app.get("/api/locations/search", async (req, res) => {
    try {
      const { q } = req.query;
      
      if (!q || String(q).trim().length < 2) {
        return res.json([]);
      }
      
      const searchQuery = String(q).trim();
      const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&countrycodes=in&limit=8&addressdetails=1`;
      
      const response = await fetch(nominatimUrl, {
        headers: {
          'User-Agent': 'KisanDecks/1.0 (farming-app)',
          'Accept': 'application/json',
        }
      });
      
      if (!response.ok) {
        return res.status(500).json({ error: "Failed to search locations" });
      }
      
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("Location search error:", error);
      res.status(500).json({ error: "Failed to search locations" });
    }
  });

  // ========== WEATHER API (Using Open-Meteo - Free, No API Key Required) ==========
  
  app.get("/api/weather", async (req, res) => {
    try {
      const { city, lat, lon } = req.query;
      
      let latitude: number;
      let longitude: number;
      let locationName: string = "";
      let country: string = "IN";
      let stateName: string = "";
      let districtName: string = "";

      // If coordinates provided, use them directly
      if (lat && lon) {
        latitude = parseFloat(String(lat));
        longitude = parseFloat(String(lon));
        
        // Reverse geocode to get location name using coordinates
        try {
          // Use a nearby city search based on coordinates
          const reverseGeoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=india&count=1&language=en`;
          locationName = `${latitude.toFixed(2)}°N, ${longitude.toFixed(2)}°E`;
        } catch {
          locationName = `${latitude.toFixed(2)}°N, ${longitude.toFixed(2)}°E`;
        }
      } else if (city) {
        // Geocode city name to get coordinates
        const searchQuery = String(city).trim();
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(searchQuery)}&count=5&language=en&format=json`;
        
        const geoResponse = await fetch(geoUrl);
        if (!geoResponse.ok) {
          return res.status(500).json({ error: "Failed to search location" });
        }
        
        const geoData = await geoResponse.json();
        
        if (!geoData.results || geoData.results.length === 0) {
          return res.status(404).json({ error: "Location not found. Please try another city name." });
        }
        
        // Prefer Indian locations
        const indianLocation = geoData.results.find((r: any) => r.country_code === "IN") || geoData.results[0];
        
        latitude = indianLocation.latitude;
        longitude = indianLocation.longitude;
        locationName = indianLocation.name;
        country = indianLocation.country_code || "IN";
        
        // Extract admin divisions (state and district)
        stateName = indianLocation.admin1 || "";
        districtName = indianLocation.admin2 || indianLocation.admin3 || "";
      } else {
        return res.status(400).json({ error: "Please provide city name or coordinates" });
      }

      // Fetch weather data from Open-Meteo (no API key required)
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,cloud_cover,pressure_msl,wind_speed_10m,precipitation_probability&hourly=precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max&timezone=Asia/Kolkata&forecast_days=6`;
      
      const weatherResponse = await fetch(weatherUrl);
      if (!weatherResponse.ok) {
        return res.status(500).json({ error: "Failed to fetch weather data" });
      }
      
      const weatherData = await weatherResponse.json();
      const current = weatherData.current;
      const daily = weatherData.daily;

      // Map weather codes to conditions
      const getWeatherCondition = (code: number): { main: string; description: string } => {
        if (code === 0) return { main: "Clear", description: "clear sky" };
        if (code === 1) return { main: "Clear", description: "mainly clear" };
        if (code === 2) return { main: "Clouds", description: "partly cloudy" };
        if (code === 3) return { main: "Clouds", description: "overcast" };
        if (code >= 45 && code <= 48) return { main: "Fog", description: "foggy" };
        if (code >= 51 && code <= 55) return { main: "Drizzle", description: "drizzle" };
        if (code >= 56 && code <= 57) return { main: "Drizzle", description: "freezing drizzle" };
        if (code >= 61 && code <= 65) return { main: "Rain", description: "rain" };
        if (code >= 66 && code <= 67) return { main: "Rain", description: "freezing rain" };
        if (code >= 71 && code <= 77) return { main: "Snow", description: "snow" };
        if (code >= 80 && code <= 82) return { main: "Rain", description: "rain showers" };
        if (code >= 85 && code <= 86) return { main: "Snow", description: "snow showers" };
        if (code >= 95 && code <= 99) return { main: "Thunderstorm", description: "thunderstorm" };
        return { main: "Clear", description: "clear" };
      };

      const condition = getWeatherCondition(current.weather_code);

      // Format sunrise/sunset times
      const formatTime = (isoString: string) => {
        const date = new Date(isoString);
        return date.toLocaleTimeString("en-IN", { 
          hour: "2-digit", 
          minute: "2-digit",
          hour12: true 
        });
      };

      // Process 5-day forecast
      const dailyForecast: any[] = [];
      for (let i = 1; i <= 5 && i < daily.time.length; i++) {
        const date = new Date(daily.time[i]);
        dailyForecast.push({
          date: date.toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
          dayName: date.toLocaleDateString("en-IN", { weekday: "short" }),
          tempMax: daily.temperature_2m_max[i],
          tempMin: daily.temperature_2m_min[i],
          condition: getWeatherCondition(daily.weather_code[i]).main,
          icon: "01d",
          rainProbability: daily.precipitation_probability_max[i] || 0,
        });
      }

      // Generate farming alerts
      const alerts: any[] = [];
      
      if (condition.main === "Rain" || condition.main === "Thunderstorm") {
        alerts.push({
          type: "Rain Alert",
          severity: condition.main === "Thunderstorm" ? "high" : "medium",
          message: "Rain expected. Protect harvested crops and ensure proper drainage in fields.",
        });
      }
      
      if (current.temperature_2m > 40) {
        alerts.push({
          type: "Extreme Heat Warning",
          severity: "high",
          message: "Very high temperatures. Irrigate crops during early morning/evening. Provide shade for livestock.",
        });
      } else if (current.temperature_2m > 35) {
        alerts.push({
          type: "Heat Advisory",
          severity: "medium",
          message: "High temperatures expected. Ensure adequate water for crops and animals.",
        });
      }
      
      if (current.temperature_2m < 5) {
        alerts.push({
          type: "Frost Warning",
          severity: "high",
          message: "Very low temperatures. Protect frost-sensitive crops with mulching or covers.",
        });
      }
      
      if (current.wind_speed_10m > 40) {
        alerts.push({
          type: "High Wind Advisory",
          severity: current.wind_speed_10m > 60 ? "high" : "medium",
          message: "Strong winds expected. Secure young plants and avoid spraying pesticides.",
        });
      }

      // Get today's date formatted
      const today = new Date();
      const todayFormatted = today.toLocaleDateString("en-IN", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      });

      const response = {
        location: locationName,
        country: country,
        state: stateName,
        district: districtName,
        date: todayFormatted,
        temp: current.temperature_2m,
        feelsLike: current.apparent_temperature,
        condition: condition.main,
        description: condition.description,
        humidity: current.relative_humidity_2m,
        windSpeed: Math.round(current.wind_speed_10m),
        visibility: 10,
        pressure: Math.round(current.pressure_msl),
        clouds: current.cloud_cover,
        sunrise: formatTime(daily.sunrise[0]),
        sunset: formatTime(daily.sunset[0]),
        icon: "01d",
        rainProbability: current.precipitation_probability || 0,
        alerts: alerts.length > 0 ? alerts : undefined,
        forecast: dailyForecast,
      };

      res.json(response);
    } catch (error: any) {
      console.error("Weather API error:", error);
      res.status(500).json({ error: "Failed to fetch weather data. Please try again." });
    }
  });

  // ========== MARKET PRICES API (APMC Mandi Rates) ==========
  
  app.get("/api/market", async (req, res) => {
    try {
      const { state, district, commodity, search } = req.query;
      
      const marketPrices = generateMarketPrices(
        String(state || ""),
        String(district || ""),
        String(commodity || ""),
        String(search || "")
      );
      
      const today = new Date();
      const lastUpdated = today.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });

      res.json({
        prices: marketPrices,
        totalCount: marketPrices.length,
        lastUpdated,
      });
    } catch (error: any) {
      console.error("Market API error:", error);
      res.status(500).json({ error: "Failed to fetch market prices. Please try again." });
    }
  });

  app.get("/api/market/catalog", async (req, res) => {
    try {
      res.json({
        states: getStatesWithMarkets(),
        commodityCategories: getCommodityCategories(),
        allCommodities: allCommodities.map(c => ({ name: c.name, category: c.category })),
      });
    } catch (error: any) {
      console.error("Market catalog error:", error);
      res.status(500).json({ error: "Failed to fetch market catalog." });
    }
  });

  app.get("/api/market/districts/:state", async (req, res) => {
    try {
      const { state } = req.params;
      res.json({
        districts: getDistrictsForState(state),
        markets: getMarketsForState(state),
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch districts." });
    }
  });

  // ========== ACCOUNT BOOK API ==========
  
  const DEFAULT_FARMER_ID = "default";

  // Expenses
  app.post("/api/account/expense", async (req, res) => {
    try {
      const { category, amount, crop, notes, photoUrl, date } = req.body;
      if (!category || !amount) {
        return res.status(400).json({ error: "Category and amount are required" });
      }
      const expense = await storage.createExpense({
        farmerId: DEFAULT_FARMER_ID,
        category,
        amount: Number(amount),
        crop: crop || null,
        notes: notes || null,
        photoUrl: photoUrl || null,
        date: date ? new Date(date) : new Date(),
      });
      res.json(expense);
    } catch (error: any) {
      console.error("Create expense error:", error);
      res.status(500).json({ error: "Failed to add expense" });
    }
  });

  app.get("/api/account/expenses", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const expenses = await storage.getExpensesByFarmer(
        DEFAULT_FARMER_ID,
        startDate ? new Date(String(startDate)) : undefined,
        endDate ? new Date(String(endDate)) : undefined
      );
      res.json(expenses);
    } catch (error: any) {
      console.error("Get expenses error:", error);
      res.status(500).json({ error: "Failed to fetch expenses" });
    }
  });

  app.delete("/api/account/expense/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteExpense(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to delete expense" });
    }
  });

  // Income
  app.post("/api/account/income", async (req, res) => {
    try {
      const { category, amount, crop, notes, quantity, unit, date } = req.body;
      if (!category || !amount) {
        return res.status(400).json({ error: "Category and amount are required" });
      }
      const income = await storage.createIncome({
        farmerId: DEFAULT_FARMER_ID,
        category,
        amount: Number(amount),
        crop: crop || null,
        notes: notes || null,
        quantity: quantity ? Number(quantity) : null,
        unit: unit || null,
        date: date ? new Date(date) : new Date(),
      });
      res.json(income);
    } catch (error: any) {
      console.error("Create income error:", error);
      res.status(500).json({ error: "Failed to add income" });
    }
  });

  app.get("/api/account/incomes", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const incomes = await storage.getIncomesByFarmer(
        DEFAULT_FARMER_ID,
        startDate ? new Date(String(startDate)) : undefined,
        endDate ? new Date(String(endDate)) : undefined
      );
      res.json(incomes);
    } catch (error: any) {
      console.error("Get incomes error:", error);
      res.status(500).json({ error: "Failed to fetch incomes" });
    }
  });

  app.delete("/api/account/income/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteIncome(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to delete income" });
    }
  });

  // Crop Tracking
  app.post("/api/account/crop", async (req, res) => {
    try {
      const { cropName, landArea, areaUnit, expectedYield, yieldUnit, sowingDate, status } = req.body;
      if (!cropName) {
        return res.status(400).json({ error: "Crop name is required" });
      }
      const crop = await storage.createCropTracking({
        farmerId: DEFAULT_FARMER_ID,
        cropName,
        landArea: landArea ? Number(landArea) : null,
        areaUnit: areaUnit || "acre",
        expectedYield: expectedYield ? Number(expectedYield) : null,
        yieldUnit: yieldUnit || "quintal",
        sowingDate: sowingDate ? new Date(sowingDate) : null,
        harvestDate: null,
        status: status || "active",
      });
      res.json(crop);
    } catch (error: any) {
      console.error("Create crop error:", error);
      res.status(500).json({ error: "Failed to add crop" });
    }
  });

  app.get("/api/account/crops", async (req, res) => {
    try {
      const crops = await storage.getCropsByFarmer(DEFAULT_FARMER_ID);
      res.json(crops);
    } catch (error: any) {
      console.error("Get crops error:", error);
      res.status(500).json({ error: "Failed to fetch crops" });
    }
  });

  app.delete("/api/account/crop/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteCrop(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to delete crop" });
    }
  });

  // Summary and Reports
  app.get("/api/account/summary", async (req, res) => {
    try {
      const { period } = req.query;
      let startDate: Date | undefined;
      const now = new Date();
      
      if (period === "week") {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (period === "month") {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      } else if (period === "year") {
        startDate = new Date(now.getFullYear(), 0, 1);
      }

      const [expenses, incomes, expenseByCategory, incomeByCategory, crops] = await Promise.all([
        storage.getExpensesByFarmer(DEFAULT_FARMER_ID, startDate),
        storage.getIncomesByFarmer(DEFAULT_FARMER_ID, startDate),
        storage.getExpenseSummaryByCategory(DEFAULT_FARMER_ID, startDate),
        storage.getIncomeSummaryByCategory(DEFAULT_FARMER_ID, startDate),
        storage.getCropsByFarmer(DEFAULT_FARMER_ID),
      ]);

      const totalExpense = expenses.reduce((sum, e) => sum + e.amount, 0);
      const totalIncome = incomes.reduce((sum, i) => sum + i.amount, 0);
      const profitLoss = totalIncome - totalExpense;

      const cropSummary: { [key: string]: { expense: number, income: number } } = {};
      expenses.forEach(e => {
        if (e.crop) {
          if (!cropSummary[e.crop]) cropSummary[e.crop] = { expense: 0, income: 0 };
          cropSummary[e.crop].expense += e.amount;
        }
      });
      incomes.forEach(i => {
        if (i.crop) {
          if (!cropSummary[i.crop]) cropSummary[i.crop] = { expense: 0, income: 0 };
          cropSummary[i.crop].income += i.amount;
        }
      });

      res.json({
        totalExpense,
        totalIncome,
        profitLoss,
        expenseByCategory,
        incomeByCategory,
        cropSummary: Object.entries(cropSummary).map(([crop, data]) => ({
          crop,
          ...data,
          profit: data.income - data.expense,
        })),
        activeCrops: crops.filter(c => c.status === "active").length,
        recentTransactions: [...expenses.slice(0, 5), ...incomes.slice(0, 5)]
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .slice(0, 10),
      });
    } catch (error: any) {
      console.error("Summary error:", error);
      res.status(500).json({ error: "Failed to fetch summary" });
    }
  });

  // ============ SMART FARMER CALCULATOR ROUTES ============

  // Calculator: Crop Cost
  app.post("/api/calculator/crop-cost", async (req, res) => {
    try {
      const { crop, landSize, seedCost, fertilizerCost, pesticideCost, labourCost, irrigationCost, otherCost } = req.body;
      const land = parseFloat(landSize) || 1;
      const seed = parseFloat(seedCost) || 0;
      const fertilizer = parseFloat(fertilizerCost) || 0;
      const pesticide = parseFloat(pesticideCost) || 0;
      const labour = parseFloat(labourCost) || 0;
      const irrigation = parseFloat(irrigationCost) || 0;
      const other = parseFloat(otherCost) || 0;

      // Total Cost = Sum of all input costs
      const totalCost = seed + fertilizer + pesticide + labour + irrigation + other;
      // Cost per Acre = Total Cost ÷ Land Size
      const costPerAcre = Math.round(totalCost / land);
      
      // Calculate percentage breakdown
      const seedPercent = totalCost > 0 ? Math.round((seed / totalCost) * 100) : 0;
      const fertilizerPercent = totalCost > 0 ? Math.round((fertilizer / totalCost) * 100) : 0;
      const pesticidePercent = totalCost > 0 ? Math.round((pesticide / totalCost) * 100) : 0;
      const labourPercent = totalCost > 0 ? Math.round((labour / totalCost) * 100) : 0;
      const irrigationPercent = totalCost > 0 ? Math.round((irrigation / totalCost) * 100) : 0;
      const otherPercent = totalCost > 0 ? Math.round((other / totalCost) * 100) : 0;
      
      // Find highest cost category
      const costCategories = [
        { name: "बीज", nameEn: "Seed", value: seed, percent: seedPercent },
        { name: "खाद", nameEn: "Fertilizer", value: fertilizer, percent: fertilizerPercent },
        { name: "कीटनाशक", nameEn: "Pesticide", value: pesticide, percent: pesticidePercent },
        { name: "मजदूरी", nameEn: "Labour", value: labour, percent: labourPercent },
        { name: "सिंचाई", nameEn: "Irrigation", value: irrigation, percent: irrigationPercent }
      ];
      const highestCost = costCategories.reduce((a, b) => a.value > b.value ? a : b);

      res.json({
        result: {
          totalCost: Math.round(totalCost),
          costPerAcre,
          seedCost: Math.round(seed),
          fertilizerCost: Math.round(fertilizer),
          labourCost: Math.round(labour)
        },
        breakdown: [
          { step: `Step 1: Land Size = ${land} acre`, stepHindi: `चरण 1: जमीन = ${land} एकड़`, value: `${land} एकड़` },
          { step: `Step 2: Seed Cost = ₹${seed.toLocaleString('en-IN')} (${seedPercent}%)`, stepHindi: `चरण 2: बीज खर्च = ₹${seed.toLocaleString('en-IN')} (${seedPercent}%)`, value: `₹${seed.toLocaleString('en-IN')}` },
          { step: `Step 3: Fertilizer = ₹${fertilizer.toLocaleString('en-IN')} (${fertilizerPercent}%)`, stepHindi: `चरण 3: खाद खर्च = ₹${fertilizer.toLocaleString('en-IN')} (${fertilizerPercent}%)`, value: `₹${fertilizer.toLocaleString('en-IN')}` },
          { step: `Step 4: Pesticide = ₹${pesticide.toLocaleString('en-IN')} (${pesticidePercent}%)`, stepHindi: `चरण 4: कीटनाशक = ₹${pesticide.toLocaleString('en-IN')} (${pesticidePercent}%)`, value: `₹${pesticide.toLocaleString('en-IN')}` },
          { step: `Step 5: Labour = ₹${labour.toLocaleString('en-IN')} (${labourPercent}%)`, stepHindi: `चरण 5: मजदूरी = ₹${labour.toLocaleString('en-IN')} (${labourPercent}%)`, value: `₹${labour.toLocaleString('en-IN')}` },
          { step: `Step 6: Irrigation = ₹${irrigation.toLocaleString('en-IN')} (${irrigationPercent}%)`, stepHindi: `चरण 6: सिंचाई = ₹${irrigation.toLocaleString('en-IN')} (${irrigationPercent}%)`, value: `₹${irrigation.toLocaleString('en-IN')}` },
          { step: `Step 7: Other = ₹${other.toLocaleString('en-IN')} (${otherPercent}%)`, stepHindi: `चरण 7: अन्य खर्च = ₹${other.toLocaleString('en-IN')} (${otherPercent}%)`, value: `₹${other.toLocaleString('en-IN')}` },
          { step: `Step 8: Total = Sum of all costs`, stepHindi: `चरण 8: कुल = सभी खर्च जोड़कर`, value: `₹${Math.round(totalCost).toLocaleString('en-IN')}` },
          { step: `Step 9: Per Acre = ₹${Math.round(totalCost).toLocaleString('en-IN')} ÷ ${land}`, stepHindi: `चरण 9: प्रति एकड़ = ₹${Math.round(totalCost).toLocaleString('en-IN')} ÷ ${land}`, value: `₹${costPerAcre.toLocaleString('en-IN')}/एकड़` }
        ],
        tips: {
          action: `${crop || "आपकी फसल"} की कुल लागत ₹${Math.round(totalCost).toLocaleString('en-IN')} (₹${costPerAcre.toLocaleString('en-IN')}/एकड़) है। सबसे ज्यादा खर्च: ${highestCost.name} (${highestCost.percent}%)।`,
          saving: `बचत के सुझाव: Organic manure से fertilizer cost 20-30% कम हो सकती है। Drip irrigation से पानी 50% और बिजली 30% बचती है। FPO/Group में pesticide खरीदें - 15-20% discount मिलता है।`,
          safety: `सभी bills और receipts रखें। KCC loan पर 4% interest subsidy के लिए eligible हैं। PM-KISAN से ₹6,000/year भी मिलता है।`
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Calculation failed" });
    }
  });

  // Calculator: Profit
  app.post("/api/calculator/profit", async (req, res) => {
    try {
      const { crop, expectedYield, sellingRate, totalCost } = req.body;
      const yieldQty = parseFloat(expectedYield) || 0;
      const rate = parseFloat(sellingRate) || 0;
      const cost = parseFloat(totalCost) || 0;

      // Revenue = Yield × Selling Price
      const totalRevenue = yieldQty * rate;
      // Net Profit = Revenue - Total Cost
      const netProfit = totalRevenue - cost;
      // Profit Margin = (Net Profit / Revenue) × 100 (shows % of revenue that is profit)
      const profitMargin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0;
      // Return on Investment (ROI) = (Net Profit / Cost) × 100 (shows % return on money invested)
      const roi = cost > 0 ? Math.round((netProfit / cost) * 100) : 0;
      // Break-even selling rate = Total Cost ÷ Yield
      const breakEvenRate = yieldQty > 0 ? Math.round(cost / yieldQty) : 0;
      // Cost per quintal
      const costPerQuintal = yieldQty > 0 ? Math.round(cost / yieldQty) : 0;

      res.json({
        result: {
          netProfit: Math.round(netProfit),
          totalRevenue: Math.round(totalRevenue),
          profitPercentage: `${roi}%`,
          breakEvenRate
        },
        breakdown: [
          { step: `Step 1: Expected Yield = ${yieldQty} quintal`, stepHindi: `चरण 1: अनुमानित उपज = ${yieldQty} क्विंटल`, value: `${yieldQty} क्विंटल` },
          { step: `Step 2: Selling Rate = ₹${rate.toLocaleString('en-IN')}/quintal`, stepHindi: `चरण 2: बिक्री दर = ₹${rate.toLocaleString('en-IN')}/क्विंटल`, value: `₹${rate.toLocaleString('en-IN')}/क्विंटल` },
          { step: `Step 3: Total Revenue = Yield × Rate = ${yieldQty} × ₹${rate.toLocaleString('en-IN')}`, stepHindi: `चरण 3: कुल बिक्री = उपज × दर = ${yieldQty} × ₹${rate.toLocaleString('en-IN')}`, value: `₹${Math.round(totalRevenue).toLocaleString('en-IN')}` },
          { step: `Step 4: Total Cost (all expenses)`, stepHindi: `चरण 4: कुल लागत (सभी खर्च)`, value: `₹${cost.toLocaleString('en-IN')}` },
          { step: `Step 5: Net Profit = Revenue - Cost = ₹${Math.round(totalRevenue).toLocaleString('en-IN')} - ₹${cost.toLocaleString('en-IN')}`, stepHindi: `चरण 5: शुद्ध मुनाफा = बिक्री - लागत = ₹${Math.round(totalRevenue).toLocaleString('en-IN')} - ₹${cost.toLocaleString('en-IN')}`, value: `₹${Math.round(netProfit).toLocaleString('en-IN')}` },
          { step: `Step 6: ROI = (Profit ÷ Cost) × 100 = ${roi}%`, stepHindi: `चरण 6: ROI = (मुनाफा ÷ लागत) × 100 = ${roi}%`, value: `${roi}% return` },
          { step: `Step 7: Break-even Rate = Cost ÷ Yield = ₹${costPerQuintal}/quintal`, stepHindi: `चरण 7: न-फायदा न-नुकसान दर = लागत ÷ उपज = ₹${costPerQuintal}/क्विंटल`, value: `₹${breakEvenRate}/क्विंटल` }
        ],
        tips: netProfit >= 0 ? {
          action: `बढ़िया! ₹${Math.round(netProfit).toLocaleString('en-IN')} का मुनाफा होगा। ROI: ${roi}% (हर ₹100 खर्च पर ₹${100 + roi} वापस)। Profit Margin: ${profitMargin}%`,
          saving: `अगर storage facility है तो 2-4 हफ्ते रुकें - भाव 5-15% और बढ़ सकता है। Warehouse receipt से loan भी मिल सकता है।`,
          safety: `MSP (Minimum Support Price) पर बेचने के लिए नजदीकी मंडी में registration करें। e-NAM portal पर भी check करें।`
        } : {
          action: `⚠️ ₹${Math.abs(Math.round(netProfit)).toLocaleString('en-IN')} का नुकसान हो सकता है। Break-even के लिए कम से कम ₹${breakEvenRate}/क्विंटल मिलना चाहिए (आपका rate ₹${rate} है)।`,
          saving: `लागत कम करने के options देखें: drip irrigation, organic fertilizers, group buying। या better market rate (₹${breakEvenRate}+ /quintal) का इंतजार करें।`,
          safety: `अगली बार बुवाई से पहले market trends और MSP rates जरूर check करें। Crop insurance (PM Fasal Bima) लेना फायदेमंद है।`
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Calculation failed" });
    }
  });

  // Calculator: Loan EMI
  app.post("/api/calculator/loan-emi", async (req, res) => {
    try {
      const { loanAmount, interestRate, tenure } = req.body;
      const principal = parseFloat(loanAmount) || 0;
      const annualRate = parseFloat(interestRate) || 0;
      const monthlyRate = annualRate / 12 / 100; // Convert annual % to monthly decimal
      const months = parseFloat(tenure) || 1;

      // Standard EMI Formula: EMI = P × r × (1+r)^n / ((1+r)^n - 1)
      // Where P = Principal, r = monthly interest rate, n = number of months
      let emi = 0;
      if (monthlyRate > 0) {
        const powerTerm = Math.pow(1 + monthlyRate, months);
        emi = (principal * monthlyRate * powerTerm) / (powerTerm - 1);
      } else {
        emi = principal / months; // Simple division if no interest
      }

      const totalPayment = emi * months;
      const totalInterest = totalPayment - principal;
      const monthlyRatePercent = (annualRate / 12).toFixed(3);

      res.json({
        result: {
          monthlyEMI: Math.round(emi),
          totalInterest: Math.round(totalInterest),
          totalPayment: Math.round(totalPayment)
        },
        breakdown: [
          { step: `Step 1: Principal (P) = ₹${principal.toLocaleString('en-IN')}`, stepHindi: `चरण 1: मूलधन (P) = ₹${principal.toLocaleString('en-IN')}`, value: `₹${principal.toLocaleString('en-IN')}` },
          { step: `Step 2: Annual rate ${annualRate}% → Monthly rate (r) = ${annualRate}% ÷ 12 = ${monthlyRatePercent}%`, stepHindi: `चरण 2: सालाना दर ${annualRate}% → मासिक दर (r) = ${annualRate}% ÷ 12 = ${monthlyRatePercent}%`, value: `${monthlyRatePercent}%/माह` },
          { step: `Step 3: Number of months (n) = ${months}`, stepHindi: `चरण 3: महीनों की संख्या (n) = ${months}`, value: `${months} महीने` },
          { step: `Step 4: EMI = P × r × (1+r)^n ÷ ((1+r)^n - 1)`, stepHindi: `चरण 4: EMI = P × r × (1+r)^n ÷ ((1+r)^n - 1)`, value: `फॉर्मूला` },
          { step: `Step 5: Monthly EMI calculated`, stepHindi: `चरण 5: मासिक EMI निकाली`, value: `₹${Math.round(emi).toLocaleString('en-IN')}/माह` },
          { step: `Step 6: Total Payment = EMI × ${months} months`, stepHindi: `चरण 6: कुल भुगतान = EMI × ${months} महीने`, value: `₹${Math.round(totalPayment).toLocaleString('en-IN')}` },
          { step: `Step 7: Total Interest = Total Payment - Principal`, stepHindi: `चरण 7: कुल ब्याज = कुल भुगतान - मूलधन`, value: `₹${Math.round(totalInterest).toLocaleString('en-IN')}` }
        ],
        tips: {
          action: `हर महीने ₹${Math.round(emi).toLocaleString('en-IN')} की EMI भरनी होगी। ${months} महीने में कुल ₹${Math.round(totalPayment).toLocaleString('en-IN')} देने होंगे।`,
          saving: `KCC (Kisan Credit Card) पर 4% interest subsidy मिलती है - bank में पूछें। अगर possible हो तो part-prepayment करें - ₹10,000 extra देने पर ~₹${Math.round(totalInterest * 0.15).toLocaleString('en-IN')} ब्याज बचेगा।`,
          safety: `EMI date याद रखें। Late payment पर penalty (2-3%) और credit score खराब होता है। Auto-debit लगवाएं।`
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Calculation failed" });
    }
  });

  // Calculator: Seed
  app.post("/api/calculator/seed", async (req, res) => {
    try {
      const { crop, landArea } = req.body;
      const area = parseFloat(landArea) || 1;

      // Seed rates based on ICAR (Indian Council of Agricultural Research) recommendations
      // Rate in kg/acre, price in ₹/kg (2024 market prices)
      const seedRates: { [key: string]: { rate: number; rateRange: string; price: number; unit: string; nameHi: string; spacing: string } } = {
        "Wheat": { rate: 45, rateRange: "40-50", price: 55, unit: "kg", nameHi: "गेहूं", spacing: "Row spacing 20-22.5 cm" },
        "Rice": { rate: 25, rateRange: "20-30", price: 65, unit: "kg", nameHi: "धान", spacing: "Transplanting: 20×15 cm" },
        "Cotton": { rate: 2.5, rateRange: "2-3", price: 1500, unit: "kg", nameHi: "कपास", spacing: "60×45 cm spacing" },
        "Soybean": { rate: 30, rateRange: "25-35", price: 90, unit: "kg", nameHi: "सोयाबीन", spacing: "45×5 cm spacing" },
        "Sugarcane": { rate: 2500, rateRange: "2000-3000", price: 4, unit: "setts", nameHi: "गन्ना", spacing: "3-bud setts, 90 cm rows" },
        "Maize": { rate: 8, rateRange: "7-10", price: 350, unit: "kg", nameHi: "मक्का", spacing: "60×20 cm spacing" },
        "Groundnut": { rate: 50, rateRange: "45-55", price: 120, unit: "kg", nameHi: "मूंगफली", spacing: "30×10 cm spacing" },
        "Mustard": { rate: 2, rateRange: "1.5-2.5", price: 250, unit: "kg", nameHi: "सरसों", spacing: "30×10 cm spacing" },
        "Chilli": { rate: 0.25, rateRange: "0.2-0.3", price: 9000, unit: "kg", nameHi: "मिर्च", spacing: "60×45 cm (transplant)" },
        "Tomato": { rate: 0.2, rateRange: "0.15-0.25", price: 18000, unit: "kg", nameHi: "टमाटर", spacing: "60×45 cm (transplant)" }
      };

      const cropData = seedRates[crop as string] || { rate: 20, rateRange: "15-25", price: 100, unit: "kg", nameHi: "फसल", spacing: "Standard" };
      const seedNeeded = parseFloat((cropData.rate * area).toFixed(2));
      const estimatedCost = Math.round(seedNeeded * cropData.price);
      const unitLabel = cropData.unit === "setts" ? "setts (टुकड़े)" : "kg";

      res.json({
        result: {
          seedNeeded: `${seedNeeded} ${unitLabel}`,
          estimatedCost,
          ratePerAcre: `${cropData.rate} ${unitLabel}/acre`
        },
        breakdown: [
          { step: `Step 1: Land area = ${area} acre`, stepHindi: `चरण 1: जमीन = ${area} एकड़`, value: `${area} एकड़` },
          { step: `Step 2: ICAR recommended seed rate for ${crop} = ${cropData.rateRange} ${unitLabel}/acre`, stepHindi: `चरण 2: ${cropData.nameHi} के लिए ICAR अनुशंसित दर = ${cropData.rateRange} ${unitLabel}/एकड़`, value: `${cropData.rate} ${unitLabel}/एकड़` },
          { step: `Step 3: Spacing: ${cropData.spacing}`, stepHindi: `चरण 3: दूरी: ${cropData.spacing}`, value: cropData.spacing },
          { step: `Step 4: Total seeds = Area × Rate = ${area} × ${cropData.rate}`, stepHindi: `चरण 4: कुल बीज = क्षेत्र × दर = ${area} × ${cropData.rate}`, value: `${seedNeeded} ${unitLabel}` },
          { step: `Step 5: Cost = ${seedNeeded} ${unitLabel} × ₹${cropData.price}/${unitLabel}`, stepHindi: `चरण 5: खर्च = ${seedNeeded} ${unitLabel} × ₹${cropData.price}/${unitLabel}`, value: `₹${estimatedCost.toLocaleString('en-IN')}` }
        ],
        tips: {
          action: `${area} एकड़ ${cropData.nameHi} के लिए ${seedNeeded} ${unitLabel} certified बीज खरीदें। Market price ~₹${cropData.price}/${unitLabel} है।`,
          saving: `Government seed store (State Seed Corporation) से खरीदें - 20-25% subsidy मिलती है। IFFCO/Krishi Kendra भी अच्छा option है। Packet पर lot number और expiry date जरूर देखें।`,
          safety: `बुवाई से पहले बीज उपचार (Seed Treatment) जरूर करें: Thiram/Carbendazim (2-3 gm/kg बीज) से treat करें - germination 15-20% बढ़ेगी और रोग कम होंगे।`
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Calculation failed" });
    }
  });

  // Calculator: Fertilizer NPK - Simple version
  app.post("/api/calculator/fertilizer", async (req, res) => {
    try {
      const { crop, landArea, soilType } = req.body;
      const area = parseFloat(landArea) || 1;

      const fertilizerNeeds: { [key: string]: { urea: number; dap: number; mop: number; nameHi: string; whenToApply: string } } = {
        "Wheat": { urea: 2.5, dap: 1, mop: 0.5, nameHi: "गेहूं", whenToApply: "DAP बुवाई पर, यूरिया 3 बार में" },
        "Rice": { urea: 2.5, dap: 1, mop: 1, nameHi: "धान", whenToApply: "DAP रोपाई पर, यूरिया 3 बार में" },
        "Cotton": { urea: 3, dap: 1.5, mop: 1, nameHi: "कपास", whenToApply: "DAP बुवाई पर, यूरिया 3 बार में" },
        "Soybean": { urea: 0.5, dap: 1.5, mop: 0.5, nameHi: "सोयाबीन", whenToApply: "सब बुवाई पर" },
        "Sugarcane": { urea: 6, dap: 2.5, mop: 2, nameHi: "गन्ना", whenToApply: "DAP बुवाई पर, यूरिया 3 बार में" },
        "Maize": { urea: 2.5, dap: 1, mop: 0.5, nameHi: "मक्का", whenToApply: "DAP बुवाई पर, यूरिया 2 बार में" },
        "Groundnut": { urea: 0.5, dap: 1, mop: 0.5, nameHi: "मूंगफली", whenToApply: "सब बुवाई पर + जिप्सम फूल पर" },
        "Mustard": { urea: 1.5, dap: 0.75, mop: 0, nameHi: "सरसों", whenToApply: "DAP बुवाई पर, यूरिया 2 बार में" }
      };

      const soilAdjust = soilType === "Black" ? 0.85 : soilType === "Sandy" ? 1.15 : 1.0;
      const cropData = fertilizerNeeds[crop as string] || { urea: 2, dap: 1, mop: 0.5, nameHi: "फसल", whenToApply: "DAP बुवाई पर" };
      
      const ureaBags = Math.ceil(cropData.urea * area * soilAdjust * 2) / 2;
      const dapBags = Math.ceil(cropData.dap * area * soilAdjust * 2) / 2;
      const mopBags = Math.ceil(cropData.mop * area * soilAdjust * 2) / 2;
      
      const ureaCost = Math.round(ureaBags * 267);
      const dapCost = Math.round(dapBags * 1350);
      const mopCost = Math.round(mopBags * 900);
      const totalCost = ureaCost + dapCost + mopCost;

      res.json({
        result: {
          ureaBags: `${ureaBags} बोरी`,
          dapBags: `${dapBags} बोरी`,
          mopBags: `${mopBags} बोरी`,
          estimatedCost: totalCost
        },
        breakdown: [
          { step: `जमीन: ${area} एकड़ | फसल: ${cropData.nameHi}`, stepHindi: `जमीन: ${area} एकड़ | फसल: ${cropData.nameHi}`, value: `${area} एकड़` },
          { step: `यूरिया: ${ureaBags} बोरी = ₹${ureaCost.toLocaleString('en-IN')}`, stepHindi: `यूरिया: ${ureaBags} बोरी = ₹${ureaCost.toLocaleString('en-IN')}`, value: `₹${ureaCost.toLocaleString('en-IN')}` },
          { step: `DAP: ${dapBags} बोरी = ₹${dapCost.toLocaleString('en-IN')}`, stepHindi: `DAP: ${dapBags} बोरी = ₹${dapCost.toLocaleString('en-IN')}`, value: `₹${dapCost.toLocaleString('en-IN')}` },
          { step: `MOP: ${mopBags} बोरी = ₹${mopCost.toLocaleString('en-IN')}`, stepHindi: `MOP: ${mopBags} बोरी = ₹${mopCost.toLocaleString('en-IN')}`, value: `₹${mopCost.toLocaleString('en-IN')}` },
          { step: `कुल खर्च: ₹${totalCost.toLocaleString('en-IN')}`, stepHindi: `कुल खर्च: ₹${totalCost.toLocaleString('en-IN')}`, value: `₹${totalCost.toLocaleString('en-IN')}` }
        ],
        tips: {
          action: `खरीदें: यूरिया ${ureaBags} + DAP ${dapBags} + MOP ${mopBags} बोरी। ${cropData.whenToApply}`,
          saving: `यूरिया 2-3 बार में डालें। Government दुकान से खरीदें।`,
          safety: `मिट्टी जांच करवाएं (₹50-100)। सही खाद = ज्यादा फसल।`
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Calculation failed" });
    }
  });

  // Calculator: Pesticide Dilution - Simple version
  app.post("/api/calculator/pesticide", async (req, res) => {
    try {
      const { pesticideQuantity, waterQuantity, tankSize } = req.body;
      const pesticide = parseFloat(pesticideQuantity) || 100;
      const water = parseFloat(waterQuantity) || 200;
      const tank = parseFloat(tankSize) || 16;

      const pesticidePerTank = Math.round((pesticide / water) * tank);
      const tanksNeeded = Math.ceil(water / tank);
      const totalCost = Math.round(pesticide * 5); // ₹5/ml average
      const costPerTank = Math.round(pesticidePerTank * 5);

      res.json({
        result: {
          pesticidePerTank: `${pesticidePerTank} ml`,
          tanksNeeded: tanksNeeded,
          dilutionRatio: `1:${Math.round(water * 1000 / pesticide)}`,
          totalCost: totalCost
        },
        breakdown: [
          { step: `दवाई: ${pesticide} ml | पानी: ${water} लीटर | टैंक: ${tank} लीटर`, stepHindi: `दवाई: ${pesticide} ml | पानी: ${water} लीटर | टैंक: ${tank} लीटर`, value: `Input` },
          { step: `प्रति टैंक दवाई: ${pesticidePerTank} ml`, stepHindi: `प्रति टैंक दवाई: ${pesticidePerTank} ml`, value: `${pesticidePerTank} ml` },
          { step: `कुल टैंक: ${tanksNeeded}`, stepHindi: `कुल टैंक: ${tanksNeeded}`, value: `${tanksNeeded} टैंक` },
          { step: `प्रति टैंक खर्च: ₹${costPerTank}`, stepHindi: `प्रति टैंक खर्च: ₹${costPerTank}`, value: `₹${costPerTank}` },
          { step: `कुल खर्च: ₹${totalCost.toLocaleString('en-IN')}`, stepHindi: `कुल खर्च: ₹${totalCost.toLocaleString('en-IN')}`, value: `₹${totalCost.toLocaleString('en-IN')}` }
        ],
        tips: {
          action: `हर ${tank}L टैंक में ${pesticidePerTank} ml दवाई डालें। कुल ${tanksNeeded} टैंक spray करें।`,
          saving: `सुबह 6-9 या शाम 4-6 बजे spray करें। हवा की दिशा में spray करें।`,
          safety: `Mask और दस्ताने पहनें। spray के बाद साबुन से नहाएं। बारिश में spray न करें।`
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Calculation failed" });
    }
  });

  // Calculator: Irrigation
  app.post("/api/calculator/irrigation", async (req, res) => {
    try {
      const { crop, soilType, landArea } = req.body;
      const area = parseFloat(landArea) || 1;

      const waterReq: { [key: string]: { water: number; frequency: string; freqHi: string; nameHi: string } } = {
        "Wheat": { water: 40000, frequency: "Every 15-20 days", freqHi: "हर 15-20 दिन", nameHi: "गेहूं" },
        "Rice": { water: 100000, frequency: "Standing water 5cm", freqHi: "5cm पानी खड़ा रखें", nameHi: "धान" },
        "Cotton": { water: 50000, frequency: "Every 12-15 days", freqHi: "हर 12-15 दिन", nameHi: "कपास" },
        "Soybean": { water: 35000, frequency: "Every 15 days", freqHi: "हर 15 दिन", nameHi: "सोयाबीन" },
        "Sugarcane": { water: 80000, frequency: "Every 7-10 days", freqHi: "हर 7-10 दिन", nameHi: "गन्ना" },
        "Maize": { water: 45000, frequency: "Every 10-15 days", freqHi: "हर 10-15 दिन", nameHi: "मक्का" },
        "Groundnut": { water: 30000, frequency: "Every 12-15 days", freqHi: "हर 12-15 दिन", nameHi: "मूंगफली" },
        "Vegetables": { water: 35000, frequency: "Every 5-7 days", freqHi: "हर 5-7 दिन", nameHi: "सब्जियां" }
      };

      const cropData = waterReq[crop as string] || { water: 40000, frequency: "Every 10-15 days", freqHi: "हर 10-15 दिन", nameHi: "फसल" };
      const soilMultiplier = soilType === "Sandy" ? 1.3 : soilType === "Clay" ? 0.8 : 1;
      const waterNeeded = Math.round(cropData.water * area * soilMultiplier);
      const seasonWater = Math.round(waterNeeded * 6);

      res.json({
        result: {
          waterNeeded: `${waterNeeded.toLocaleString('en-IN')} लीटर`,
          irrigationFrequency: cropData.freqHi,
          annualWater: `${seasonWater.toLocaleString('en-IN')} लीटर/सीजन`
        },
        breakdown: [
          { step: `Base water need for ${crop}: ${cropData.water.toLocaleString('en-IN')} L/acre/irrigation`, stepHindi: `${cropData.nameHi} की पानी जरूरत: ${cropData.water.toLocaleString('en-IN')} L/एकड़/सिंचाई`, value: `${cropData.water.toLocaleString('en-IN')} L` },
          { step: `${soilType || "Your"} soil adjustment: ×${soilMultiplier}`, stepHindi: `${soilType || "आपकी"} मिट्टी adjustment: ×${soilMultiplier}`, value: `×${soilMultiplier}` },
          { step: `For ${area} acre = ${cropData.water.toLocaleString('en-IN')} × ${area} × ${soilMultiplier}`, stepHindi: `${area} एकड़ के लिए = ${cropData.water.toLocaleString('en-IN')} × ${area} × ${soilMultiplier}`, value: `${waterNeeded.toLocaleString('en-IN')} L` },
          { step: `Frequency: ${cropData.frequency}`, stepHindi: `बारंबारता: ${cropData.freqHi}`, value: cropData.freqHi },
          { step: `Per season (6 irrigations): ${waterNeeded.toLocaleString('en-IN')} × 6`, stepHindi: `प्रति सीजन (6 सिंचाई): ${waterNeeded.toLocaleString('en-IN')} × 6`, value: `${seasonWater.toLocaleString('en-IN')} L` }
        ],
        tips: {
          action: `${cropData.nameHi} के लिए ${cropData.freqHi} पानी दें। हर सिंचाई में ~${waterNeeded.toLocaleString('en-IN')} लीटर (${Math.round(waterNeeded/1000)} हजार लीटर) पानी चाहिए।`,
          saving: `Drip irrigation से 30-50% पानी बचता है। Government subsidy भी मिलती है (50-90%)। सुबह 6-8 बजे पानी देना best है।`,
          safety: soilType === "Sandy" 
            ? `रेतीली मिट्टी में पानी जल्दी उतर जाता है - कम पानी ज्यादा बार दें।`
            : `शाम को पानी देने से fungal disease का खतरा बढ़ता है। सुबह पानी दें।`
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Calculation failed" });
    }
  });

  // Calculator: Machinery/Diesel Cost
  app.post("/api/calculator/machinery", async (req, res) => {
    try {
      const { machineType, hours, fuelRate, fuelConsumption } = req.body;
      const h = parseFloat(hours) || 1;
      const dieselRate = parseFloat(fuelRate) || 90;
      const consumption = parseFloat(fuelConsumption) || 4;

      const fuelNeeded = h * consumption;
      const fuelCost = fuelNeeded * dieselRate;

      const machineData: { [key: string]: { rental: number; nameHi: string } } = {
        "Tractor": { rental: 800, nameHi: "ट्रैक्टर" },
        "Harvester": { rental: 2000, nameHi: "हार्वेस्टर" },
        "Rotavator": { rental: 1200, nameHi: "रोटावेटर" },
        "Thresher": { rental: 600, nameHi: "थ्रेशर" },
        "Pump Set": { rental: 100, nameHi: "पंप सेट" },
        "Sprayer": { rental: 200, nameHi: "स्प्रेयर" }
      };

      const machine = machineData[machineType as string] || { rental: 800, nameHi: "मशीन" };
      const rental = machine.rental * h;
      const totalCost = fuelCost + rental;

      res.json({
        result: {
          totalCost: Math.round(totalCost),
          fuelCost: Math.round(fuelCost),
          rentalCost: Math.round(rental),
          fuelNeeded: `${Math.round(fuelNeeded)} लीटर`
        },
        breakdown: [
          { step: `Working hours: ${h}`, stepHindi: `काम के घंटे: ${h}`, value: `${h} घंटे` },
          { step: `Fuel consumption: ${consumption} L/hour × ${h} hours`, stepHindi: `डीजल खपत: ${consumption} L/घंटा × ${h} घंटे`, value: `${Math.round(fuelNeeded)} L` },
          { step: `Fuel cost: ${Math.round(fuelNeeded)}L × ₹${dieselRate}`, stepHindi: `डीजल खर्च: ${Math.round(fuelNeeded)}L × ₹${dieselRate}`, value: `₹${Math.round(fuelCost).toLocaleString('en-IN')}` },
          { step: `${machineType} rental: ₹${machine.rental}/hour × ${h}`, stepHindi: `${machine.nameHi} किराया: ₹${machine.rental}/घंटा × ${h}`, value: `₹${Math.round(rental).toLocaleString('en-IN')}` },
          { step: `Total = Fuel + Rental`, stepHindi: `कुल = डीजल + किराया`, value: `₹${Math.round(totalCost).toLocaleString('en-IN')}` }
        ],
        tips: {
          action: `${machine.nameHi} ${h} घंटे चलाने पर ₹${Math.round(totalCost).toLocaleString('en-IN')} खर्च आएगा।`,
          saving: `FPO से किराया लें - 20% सस्ता मिलता है। Machine की regular servicing से 15% diesel बचता है।`,
          safety: `Peak season (कटाई) में harvester पहले से book करें। Last minute में double rate लगता है।`
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Calculation failed" });
    }
  });

  // Calculator: Labour Cost
  app.post("/api/calculator/labour", async (req, res) => {
    try {
      const { labourCount, ratePerDay, days } = req.body;
      const count = parseFloat(labourCount) || 1;
      const dailyRate = parseFloat(ratePerDay) || 350;
      const d = parseFloat(days) || 1;

      const totalCost = count * dailyRate * d;
      const costPerDay = count * dailyRate;

      res.json({
        result: {
          totalLabourCost: Math.round(totalCost),
          costPerDay: Math.round(costPerDay),
          costPerWorkerDay: Math.round(dailyRate)
        },
        breakdown: [
          { step: `Number of workers: ${count}`, stepHindi: `मजदूरों की संख्या: ${count}`, value: `${count} व्यक्ति` },
          { step: `Daily wage per worker: ₹${dailyRate}`, stepHindi: `प्रति मजदूर दिहाड़ी: ₹${dailyRate}`, value: `₹${dailyRate}` },
          { step: `Number of days: ${d}`, stepHindi: `दिनों की संख्या: ${d}`, value: `${d} दिन` },
          { step: `Total = ${count} × ₹${dailyRate} × ${d} days`, stepHindi: `कुल = ${count} × ₹${dailyRate} × ${d} दिन`, value: `₹${Math.round(totalCost).toLocaleString('en-IN')}` }
        ],
        tips: {
          action: `${count} मजदूर × ${d} दिन = ₹${Math.round(totalCost).toLocaleString('en-IN')} मजदूरी देनी होगी।`,
          saving: dailyRate > 400 
            ? `आपकी rate ₹${dailyRate} average (₹300-400) से ज्यादा है। SHG group या MNREGA workers से संपर्क करें।`
            : `आपकी rate market average के अंदर है। महिला SHG groups अक्सर ज्यादा reliable होती हैं।`,
          safety: `मजदूरी का record रखें। Group booking पर discount मिल सकता है।`
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Calculation failed" });
    }
  });

  // Calculator: Storage Cost
  app.post("/api/calculator/storage", async (req, res) => {
    try {
      const { quantity, storageRate, days } = req.body;
      const qty = parseFloat(quantity) || 1;
      const monthlyRate = parseFloat(storageRate) || 50;
      const d = parseFloat(days) || 30;

      const dailyRate = monthlyRate / 30;
      const totalCost = Math.round(qty * dailyRate * d);
      const costPerQuintal = Math.round(totalCost / qty);

      res.json({
        result: {
          totalStorageCost: totalCost,
          costPerQuintal,
          costPerDay: Math.round(qty * dailyRate)
        },
        breakdown: [
          { step: `Quantity: ${qty} quintal`, stepHindi: `मात्रा: ${qty} क्विंटल`, value: `${qty} क्विंटल` },
          { step: `Monthly rate: ₹${monthlyRate}/quintal`, stepHindi: `मासिक दर: ₹${monthlyRate}/क्विंटल`, value: `₹${monthlyRate}/माह` },
          { step: `Daily rate = ₹${monthlyRate} ÷ 30`, stepHindi: `दैनिक दर = ₹${monthlyRate} ÷ 30`, value: `₹${dailyRate.toFixed(2)}/दिन` },
          { step: `Storage days: ${d}`, stepHindi: `भंडारण दिन: ${d}`, value: `${d} दिन` },
          { step: `Total = ${qty} × ₹${dailyRate.toFixed(2)} × ${d}`, stepHindi: `कुल = ${qty} × ₹${dailyRate.toFixed(2)} × ${d}`, value: `₹${totalCost.toLocaleString('en-IN')}` }
        ],
        tips: {
          action: `${qty} क्विंटल को ${d} दिन रखने का खर्च ₹${totalCost.toLocaleString('en-IN')} आएगा।`,
          saving: `Government warehouse (₹30-40/क्विंटल/माह) private (₹80-120) से सस्ता है। FCI approved गोदाम खोजें।`,
          safety: costPerQuintal > 100 
            ? `⚠️ Storage cost ₹${costPerQuintal}/क्विंटल बहुत ज्यादा है। तुरंत बेचना better हो सकता है।`
            : `Moisture और कीड़े से बचाव के लिए fumigation करवाएं। Warehouse receipt लेना न भूलें।`
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Calculation failed" });
    }
  });

  // ============ ONLINE LEARNING MODULE ROUTES ============

  // Configure multer for media uploads (videos and audio)
  const mediaUploadDir = path.join(process.cwd(), "uploads");
  ["videos", "audio", "thumbnails", "live-recordings"].forEach(dir => {
    const fullPath = path.join(mediaUploadDir, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  const mediaStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      const isVideo = file.mimetype.startsWith("video/");
      const isAudio = file.mimetype.startsWith("audio/");
      const isImage = file.mimetype.startsWith("image/");
      
      let folder = "uploads";
      if (isVideo) folder = "uploads/videos";
      else if (isAudio) folder = "uploads/audio";
      else if (isImage) folder = "uploads/thumbnails";
      
      cb(null, folder);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
      cb(null, `${uniqueSuffix}${ext}`);
    },
  });

  const mediaUpload = multer({
    storage: mediaStorage,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit for videos
    fileFilter: (req, file, cb) => {
      const allowedVideo = ["video/mp4", "video/webm", "video/quicktime"];
      const allowedAudio = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg"];
      const allowedImage = ["image/jpeg", "image/png", "image/webp"];
      const allowed = [...allowedVideo, ...allowedAudio, ...allowedImage];
      
      if (allowed.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Only video (MP4), audio (MP3), and image files are allowed"));
      }
    },
  });

  // ===== MEDIA STREAMING ROUTES =====

  // Stream video file with range request support (public access)
  app.get("/api/learning/stream/video/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const content = await storage.getLearningContentById(id);
      
      if (!content || content.type !== "video") {
        return res.status(404).json({ error: "Video not found" });
      }
      
      const filePath = path.join(process.cwd(), content.filePath);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Video file not found" });
      }
      
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;
      
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const file = fs.createReadStream(filePath, { start, end });
        
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": content.mimeType || "video/mp4",
        });
        file.pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": content.mimeType || "video/mp4",
        });
        fs.createReadStream(filePath).pipe(res);
      }
      
      // Increment view count
      await storage.incrementViewCount(id);
    } catch (error: any) {
      console.error("Video streaming error:", error);
      res.status(500).json({ error: "Failed to stream video" });
    }
  });

  // Stream audio file (public access)
  app.get("/api/learning/stream/audio/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const content = await storage.getLearningContentById(id);
      
      if (!content || content.type !== "audio") {
        return res.status(404).json({ error: "Audio not found" });
      }
      
      const filePath = path.join(process.cwd(), content.filePath);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Audio file not found" });
      }
      
      const stat = fs.statSync(filePath);
      const range = req.headers.range;
      
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunksize = end - start + 1;
        
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": content.mimeType || "audio/mpeg",
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": stat.size,
          "Content-Type": content.mimeType || "audio/mpeg",
        });
        fs.createReadStream(filePath).pipe(res);
      }
      
      await storage.incrementViewCount(id);
    } catch (error: any) {
      console.error("Audio streaming error:", error);
      res.status(500).json({ error: "Failed to stream audio" });
    }
  });

  // Download content for offline use (public access)
  app.get("/api/learning/download/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const content = await storage.getLearningContentById(id);
      
      if (!content) {
        return res.status(404).json({ error: "Content not found" });
      }
      
      if (!content.isDownloadable) {
        return res.status(403).json({ error: "Content is not downloadable" });
      }
      
      const filePath = path.join(process.cwd(), content.filePath);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }
      
      // Update download count
      await storage.incrementViewCount(id);
      
      const filename = `${content.title.replace(/[^a-zA-Z0-9]/g, "_")}_${id}${path.extname(content.filePath)}`;
      res.download(filePath, filename);
    } catch (error: any) {
      console.error("Download error:", error);
      res.status(500).json({ error: "Failed to download content" });
    }
  });

  // Serve thumbnail images
  app.get("/api/learning/thumbnail/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const content = await storage.getLearningContentById(id);
      
      if (!content || !content.thumbnailPath) {
        return res.status(404).json({ error: "Thumbnail not found" });
      }
      
      const filePath = path.join(process.cwd(), content.thumbnailPath);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Thumbnail file not found" });
      }
      
      res.sendFile(filePath);
    } catch (error: any) {
      console.error("Thumbnail error:", error);
      res.status(500).json({ error: "Failed to load thumbnail" });
    }
  });

  // ===== ADMIN MEDIA UPLOAD ROUTES =====

  // Upload video (admin only)
  app.post("/api/admin/learning/upload/video", requireAdmin, mediaUpload.fields([
    { name: "video", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 }
  ]), async (req, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      
      if (!files.video || files.video.length === 0) {
        return res.status(400).json({ error: "Video file is required" });
      }
      
      const videoFile = files.video[0];
      const thumbnailFile = files.thumbnail?.[0];
      
      const { title, titleHindi, category, description, descriptionHindi, duration, language, tags } = req.body;
      
      const content = await storage.createLearningContent({
        type: "video",
        title: title || "Untitled Video",
        titleHindi,
        category: category || "crop-management",
        description,
        descriptionHindi,
        duration: duration ? parseInt(duration) : undefined,
        language: language || "hindi",
        filePath: videoFile.path.replace(process.cwd(), ""),
        thumbnailPath: thumbnailFile ? thumbnailFile.path.replace(process.cwd(), "") : undefined,
        fileSize: videoFile.size,
        mimeType: videoFile.mimetype,
        tags,
        isDownloadable: true,
        uploadedByAdminId: req.session.adminId,
      });
      
      res.json({ success: true, content });
    } catch (error: any) {
      console.error("Video upload error:", error);
      res.status(500).json({ error: "Failed to upload video" });
    }
  });

  // Upload audio (admin only)
  app.post("/api/admin/learning/upload/audio", requireAdmin, mediaUpload.fields([
    { name: "audio", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 }
  ]), async (req, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      
      if (!files.audio || files.audio.length === 0) {
        return res.status(400).json({ error: "Audio file is required" });
      }
      
      const audioFile = files.audio[0];
      const thumbnailFile = files.thumbnail?.[0];
      
      const { title, titleHindi, category, description, descriptionHindi, duration, language, tags } = req.body;
      
      const content = await storage.createLearningContent({
        type: "audio",
        title: title || "Untitled Audio",
        titleHindi,
        category: category || "crop-management",
        description,
        descriptionHindi,
        duration: duration ? parseInt(duration) : undefined,
        language: language || "hindi",
        filePath: audioFile.path.replace(process.cwd(), ""),
        thumbnailPath: thumbnailFile ? thumbnailFile.path.replace(process.cwd(), "") : undefined,
        fileSize: audioFile.size,
        mimeType: audioFile.mimetype,
        tags,
        isDownloadable: true,
        uploadedByAdminId: req.session.adminId,
      });
      
      res.json({ success: true, content });
    } catch (error: any) {
      console.error("Audio upload error:", error);
      res.status(500).json({ error: "Failed to upload audio" });
    }
  });

  // Generate share link (public access)
  app.post("/api/learning/share", async (req, res) => {
    try {
      const { contentId, contentType } = req.body;
      
      if (!contentId || !contentType) {
        return res.status(400).json({ error: "Content ID and type required" });
      }
      
      // Generate unique token
      const shareToken = crypto.randomBytes(32).toString("hex");
      
      // Set expiry to 7 days from now
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      
      const share = await storage.createContentShare({
        contentId,
        contentType,
        shareToken,
        sharedByFarmerId: req.session?.farmerId ?? null,
        expiresAt,
      });
      
      // Generate shareable URL
      const shareUrl = `/learning/share/${shareToken}`;
      
      res.json({ success: true, shareUrl, expiresAt });
    } catch (error: any) {
      console.error("Share creation error:", error);
      res.status(500).json({ error: "Failed to create share link" });
    }
  });

  // Validate share link (public access - no login required)
  app.get("/api/learning/share/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const share = await storage.getContentShareByToken(token);
      
      if (!share) {
        return res.status(404).json({ valid: false, error: "Share link not found" });
      }
      
      if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
        return res.status(410).json({ valid: false, error: "Share link expired" });
      }
      
      // Increment access count
      await storage.incrementShareAccessCount(share.id);
      
      res.json({ 
        valid: true, 
        contentId: share.contentId,
        contentType: share.contentType
      });
    } catch (error: any) {
      console.error("Share validation error:", error);
      res.status(500).json({ error: "Failed to validate share link" });
    }
  });

  // Get learning content (videos/audios) - public list but auth required to stream
  app.get("/api/learning/content", async (req, res) => {
    try {
      const { type, category, q } = req.query;
      const content = await storage.getLearningContent(
        type as string | undefined,
        category as string | undefined,
        q as string | undefined
      );
      res.json(content);
    } catch (error: any) {
      console.error("Learning content error:", error);
      res.status(500).json({ error: "Failed to fetch content" });
    }
  });

  // Get single content by ID
  app.get("/api/learning/content/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const content = await storage.getLearningContentById(id);
      if (!content) {
        return res.status(404).json({ error: "Content not found" });
      }
      // Increment view count
      await storage.incrementViewCount(id);
      res.json(content);
    } catch (error: any) {
      console.error("Content fetch error:", error);
      res.status(500).json({ error: "Failed to fetch content" });
    }
  });

  // Create learning content (admin)
  app.post("/api/learning/content", async (req, res) => {
    try {
      const { insertLearningContentSchema } = await import("@shared/schema");
      const parsed = insertLearningContentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid content data", details: parsed.error.format() });
      }
      const content = await storage.createLearningContent(parsed.data);
      res.json(content);
    } catch (error: any) {
      console.error("Content creation error:", error);
      res.status(500).json({ error: "Failed to create content" });
    }
  });

  // Get all workshops
  app.get("/api/learning/workshops", async (req, res) => {
    try {
      const workshopsList = await storage.getWorkshops();
      res.json(workshopsList);
    } catch (error: any) {
      console.error("Workshops fetch error:", error);
      res.status(500).json({ error: "Failed to fetch workshops" });
    }
  });

  // Create workshop (admin)
  app.post("/api/learning/workshops", async (req, res) => {
    try {
      const { insertWorkshopSchema } = await import("@shared/schema");
      const parsed = insertWorkshopSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid workshop data", details: parsed.error.format() });
      }
      const workshop = await storage.createWorkshop(parsed.data);
      res.json(workshop);
    } catch (error: any) {
      console.error("Workshop creation error:", error);
      res.status(500).json({ error: "Failed to create workshop" });
    }
  });

  // Register for workshop
  app.post("/api/learning/workshops/:id/register", async (req, res) => {
    try {
      const workshopId = parseInt(req.params.id);
      if (isNaN(workshopId)) {
        return res.status(400).json({ error: "Invalid workshop ID" });
      }
      
      const { farmerName, farmerPhone } = req.body;
      if (!farmerName || typeof farmerName !== 'string') {
        return res.status(400).json({ error: "Farmer name is required" });
      }
      
      // Check if workshop exists
      const workshop = await storage.getWorkshopById(workshopId);
      if (!workshop) {
        return res.status(404).json({ error: "Workshop not found" });
      }
      
      // Check if already registered
      const isRegistered = await storage.isUserRegistered(workshopId, DEFAULT_FARMER_ID);
      if (isRegistered) {
        return res.status(400).json({ error: "Already registered for this workshop" });
      }
      
      const registration = await storage.registerForWorkshop({
        workshopId,
        farmerId: DEFAULT_FARMER_ID,
        farmerName: farmerName.trim(),
        farmerPhone: farmerPhone?.trim() || undefined,
      });
      res.json({ success: true, registration });
    } catch (error: any) {
      console.error("Workshop registration error:", error);
      res.status(500).json({ error: "Failed to register" });
    }
  });

  // Bookmark content
  app.post("/api/learning/bookmark", async (req, res) => {
    try {
      const { contentId, contentType } = req.body;
      if (!contentId || typeof contentId !== 'number') {
        return res.status(400).json({ error: "Valid content ID is required" });
      }
      if (!contentType || !['video', 'audio'].includes(contentType)) {
        return res.status(400).json({ error: "Content type must be 'video' or 'audio'" });
      }
      
      const progress = await storage.bookmarkContent(DEFAULT_FARMER_ID, contentId, contentType);
      res.json({ success: true, isBookmarked: progress.isBookmarked });
    } catch (error: any) {
      console.error("Bookmark error:", error);
      res.status(500).json({ error: "Failed to bookmark" });
    }
  });

  // Get my learning progress
  app.get("/api/learning/my-learning", async (req, res) => {
    try {
      const [progress, bookmarked] = await Promise.all([
        storage.getLearningProgress(DEFAULT_FARMER_ID),
        storage.getBookmarkedContent(DEFAULT_FARMER_ID),
      ]);
      res.json({ progress, bookmarked });
    } catch (error: any) {
      console.error("My learning error:", error);
      res.status(500).json({ error: "Failed to fetch learning progress" });
    }
  });

  // Update learning progress
  app.post("/api/learning/progress", async (req, res) => {
    try {
      const { contentId, contentType, watchedSeconds, totalSeconds, completedPercent, isCompleted } = req.body;
      
      if (!contentId || typeof contentId !== 'number') {
        return res.status(400).json({ error: "Valid content ID is required" });
      }
      if (!contentType || !['video', 'audio'].includes(contentType)) {
        return res.status(400).json({ error: "Content type must be 'video' or 'audio'" });
      }
      
      const progress = await storage.upsertLearningProgress({
        farmerId: DEFAULT_FARMER_ID,
        contentId,
        contentType,
        watchedSeconds: typeof watchedSeconds === 'number' ? watchedSeconds : 0,
        totalSeconds: typeof totalSeconds === 'number' ? totalSeconds : 0,
        completedPercent: typeof completedPercent === 'number' ? completedPercent : 0,
        isCompleted: typeof isCompleted === 'boolean' ? isCompleted : false,
      });
      res.json({ success: true, progress });
    } catch (error: any) {
      console.error("Progress update error:", error);
      res.status(500).json({ error: "Failed to update progress" });
    }
  });

  // Seed sample learning content
  app.post("/api/learning/seed", async (req, res) => {
    try {
      // Sample videos
      const sampleVideos = [
        {
          type: "video",
          title: "Modern Wheat Farming Techniques",
          titleHindi: "आधुनिक गेहूं खेती तकनीक",
          category: "crop-management",
          description: "Learn modern techniques for wheat cultivation to increase yield",
          descriptionHindi: "उपज बढ़ाने के लिए गेहूं की आधुनिक खेती तकनीक सीखें",
          duration: 1200,
          language: "hindi",
          contentUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          contentSource: "youtube",
          tags: "wheat,farming,modern,techniques",
          isDownloadable: true,
        },
        {
          type: "video",
          title: "Drip Irrigation Setup Guide",
          titleHindi: "ड्रिप सिंचाई स्थापना गाइड",
          category: "irrigation",
          description: "Step by step guide to install drip irrigation system",
          descriptionHindi: "ड्रिप सिंचाई प्रणाली स्थापित करने की चरण-दर-चरण मार्गदर्शिका",
          duration: 900,
          language: "hindi",
          contentUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          contentSource: "youtube",
          tags: "irrigation,drip,water,save",
          isDownloadable: true,
        },
        {
          type: "video",
          title: "Organic Fertilizer Making at Home",
          titleHindi: "घर पर जैविक खाद बनाना",
          category: "organic-farming",
          description: "Make organic fertilizer at home using kitchen waste",
          descriptionHindi: "रसोई के कचरे से घर पर जैविक खाद बनाएं",
          duration: 600,
          language: "hindi",
          contentUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          contentSource: "youtube",
          tags: "organic,fertilizer,compost,home",
          isDownloadable: true,
        },
      ];

      // Sample audios
      const sampleAudios = [
        {
          type: "audio",
          title: "Daily Farming Tips",
          titleHindi: "दैनिक खेती टिप्स",
          category: "crop-management",
          description: "Quick daily tips for better farming practices",
          descriptionHindi: "बेहतर खेती के लिए त्वरित दैनिक सुझाव",
          duration: 300,
          language: "hindi",
          contentUrl: "https://example.com/audio1.mp3",
          contentSource: "upload",
          tags: "tips,daily,farming",
          isDownloadable: true,
        },
        {
          type: "audio",
          title: "Weather Updates for Farmers",
          titleHindi: "किसानों के लिए मौसम अपडेट",
          category: "weather-climate",
          description: "Weekly weather forecast and farming advice",
          descriptionHindi: "साप्ताहिक मौसम पूर्वानुमान और खेती सलाह",
          duration: 180,
          language: "hindi",
          contentUrl: "https://example.com/audio2.mp3",
          contentSource: "upload",
          tags: "weather,forecast,weekly",
          isDownloadable: true,
        },
        {
          type: "audio",
          title: "Government Scheme Updates",
          titleHindi: "सरकारी योजना अपडेट",
          category: "govt-schemes",
          description: "Latest government schemes for farmers",
          descriptionHindi: "किसानों के लिए नवीनतम सरकारी योजनाएं",
          duration: 420,
          language: "hindi",
          contentUrl: "https://example.com/audio3.mp3",
          contentSource: "upload",
          tags: "government,scheme,subsidy",
          isDownloadable: true,
        },
      ];

      // Sample workshops
      const sampleWorkshops = [
        {
          title: "Live Q&A: Rabi Crop Planning",
          titleHindi: "लाइव प्रश्नोत्तर: रबी फसल योजना",
          description: "Interactive session on planning rabi crops for maximum profit",
          descriptionHindi: "अधिकतम लाभ के लिए रबी फसलों की योजना पर इंटरैक्टिव सत्र",
          category: "crop-management",
          trainerName: "Dr. Ramesh Kumar",
          trainerNameHindi: "डॉ. रमेश कुमार",
          scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
          durationMinutes: 60,
          language: "hindi",
          maxSeats: 100,
          joinLink: "https://youtube.com/live/example",
          joinMethod: "youtube",
        },
        {
          title: "Organic Certification Workshop",
          titleHindi: "जैविक प्रमाणन कार्यशाला",
          description: "How to get organic certification for your farm",
          descriptionHindi: "अपने खेत के लिए जैविक प्रमाणन कैसे प्राप्त करें",
          category: "organic-farming",
          trainerName: "Priya Sharma",
          trainerNameHindi: "प्रिया शर्मा",
          scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
          durationMinutes: 90,
          language: "hindi",
          maxSeats: 50,
          joinLink: "https://meet.google.com/example",
          joinMethod: "meet",
        },
      ];

      // Insert all content
      for (const video of sampleVideos) {
        await storage.createLearningContent(video as any);
      }
      for (const audio of sampleAudios) {
        await storage.createLearningContent(audio as any);
      }
      for (const workshop of sampleWorkshops) {
        await storage.createWorkshop(workshop as any);
      }

      res.json({ message: "Sample content seeded successfully", videos: sampleVideos.length, audios: sampleAudios.length, workshops: sampleWorkshops.length });
    } catch (error: any) {
      console.error("Seed error:", error);
      res.status(500).json({ error: "Failed to seed content" });
    }
  });

  // AI Analysis
  app.post("/api/account/ai-analysis", async (req, res) => {
    try {
      const [expenses, incomes, crops] = await Promise.all([
        storage.getExpensesByFarmer(DEFAULT_FARMER_ID),
        storage.getIncomesByFarmer(DEFAULT_FARMER_ID),
        storage.getCropsByFarmer(DEFAULT_FARMER_ID),
      ]);

      const totalExpense = expenses.reduce((sum, e) => sum + e.amount, 0);
      const totalIncome = incomes.reduce((sum, i) => sum + i.amount, 0);
      const expenseByCategory: { [key: string]: number } = {};
      expenses.forEach(e => {
        expenseByCategory[e.category] = (expenseByCategory[e.category] || 0) + e.amount;
      });

      const prompt = `You are a farming financial advisor for Indian farmers. Analyze this farmer's account data and provide helpful insights in simple Hindi-English mix language:

Expenses Summary:
- Total Expenses: ₹${totalExpense}
- By Category: ${JSON.stringify(expenseByCategory)}
- Total Transactions: ${expenses.length}

Income Summary:
- Total Income: ₹${totalIncome}
- Profit/Loss: ₹${totalIncome - totalExpense}

Active Crops: ${crops.filter(c => c.status === "active").map(c => c.cropName).join(", ") || "None"}

Provide:
1. 2-3 smart alerts about spending patterns
2. Cost saving tips specific to their expenses
3. Profit prediction based on current trends
4. Comparison with average Indian farmer expenses

Keep response concise, practical, and farmer-friendly. Use ₹ symbol for prices.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
      });

      res.json({
        analysis: response.choices[0].message.content,
        summary: {
          totalExpense,
          totalIncome,
          profitLoss: totalIncome - totalExpense,
        },
      });
    } catch (error: any) {
      console.error("AI analysis error:", error);
      res.status(500).json({ error: "Failed to generate AI analysis" });
    }
  });

  // ========== TRANSLATION ROUTES ==========

  // Translation route using LibreTranslate (free, no API key)
  app.post("/api/translate", async (req, res) => {
    try {
      const { text, source, target } = req.body;

      if (!text || !target) {
        return res.status(400).json({ error: "Text and target language required" });
      }

      // Map language codes to LibreTranslate format
      const langMap: Record<string, string> = {
        en: "en",
        hi: "hi",
        mr: "mr",
        gu: "gu",
        pa: "pa",
        ta: "ta",
        te: "te",
        bn: "bn",
        kn: "kn",
        ml: "ml",
      };

      const sourceLang = langMap[source || "en"] || "en";
      const targetLang = langMap[target] || "hi";

      // Use LibreTranslate free API
      const response = await fetch("https://libretranslate.com/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: text,
          source: sourceLang,
          target: targetLang,
          format: "text",
        }),
      });

      if (!response.ok) {
        // Fallback: return original text if translation fails
        return res.json({ translatedText: text, source: sourceLang, target: targetLang });
      }

      const data = await response.json();
      res.json({
        translatedText: data.translatedText || text,
        source: sourceLang,
        target: targetLang,
      });
    } catch (error: any) {
      console.error("Translation error:", error);
      // Return original text as fallback
      res.json({ translatedText: req.body.text || "", error: "Translation service unavailable" });
    }
  });

  // Batch translation route
  app.post("/api/translate/batch", async (req, res) => {
    try {
      const { texts, source, target } = req.body;

      if (!Array.isArray(texts) || !target) {
        return res.status(400).json({ error: "Texts array and target language required" });
      }

      const results = await Promise.all(
        texts.map(async (text: string) => {
          try {
            const response = await fetch("https://libretranslate.com/translate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                q: text,
                source: source || "en",
                target: target,
                format: "text",
              }),
            });

            if (!response.ok) return text;
            const data = await response.json();
            return data.translatedText || text;
          } catch {
            return text;
          }
        })
      );

      res.json({ translations: results });
    } catch (error: any) {
      console.error("Batch translation error:", error);
      res.status(500).json({ error: "Batch translation failed" });
    }
  });

  return httpServer;
}
