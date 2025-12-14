import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Farmers table for learning module authentication
export const farmers = pgTable("farmers", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  password: text("password").notNull(),
  name: varchar("name", { length: 100 }),
  village: varchar("village", { length: 100 }),
  district: varchar("district", { length: 100 }),
  state: varchar("state", { length: 50 }),
  language: varchar("language", { length: 20 }).default("hindi"),
  crops: text("crops"), // comma separated
  profilePhoto: text("profile_photo"), // URL to uploaded profile photo
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
});

export const insertFarmerSchema = createInsertSchema(farmers).omit({
  id: true,
  createdAt: true,
  lastLoginAt: true,
});

export const farmerLoginSchema = z.object({
  phone: z.string().min(10).max(15),
  password: z.string().min(4),
});

export const farmerRegisterSchema = z.object({
  phone: z.string().min(10).max(15),
  password: z.string().min(4),
  name: z.string().optional(),
  village: z.string().optional(),
  district: z.string().optional(),
  state: z.string().optional(),
  language: z.enum(["hindi", "english", "marathi"]).optional(),
});

export type InsertFarmer = z.infer<typeof insertFarmerSchema>;
export type Farmer = typeof farmers.$inferSelect;

// Content share tokens for protected links
export const contentShares = pgTable("content_shares", {
  id: serial("id").primaryKey(),
  contentId: integer("content_id").notNull(),
  contentType: varchar("content_type", { length: 20 }).notNull(), // video, audio, workshop
  shareToken: varchar("share_token", { length: 64 }).notNull().unique(),
  sharedByFarmerId: integer("shared_by_farmer_id"),
  expiresAt: timestamp("expires_at"),
  accessCount: integer("access_count").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ContentShare = typeof contentShares.$inferSelect;

// Admin table
export const admins = pgTable("admins", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAdminSchema = createInsertSchema(admins).omit({
  id: true,
  createdAt: true,
});

export type InsertAdmin = z.infer<typeof insertAdminSchema>;
export type Admin = typeof admins.$inferSelect;

// Experts table
export const experts = pgTable("experts", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  category: varchar("category", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertExpertSchema = createInsertSchema(experts).omit({
  id: true,
  createdAt: true,
});

export type InsertExpert = z.infer<typeof insertExpertSchema>;
export type Expert = typeof experts.$inferSelect;

// Bookings table with expert assignment
export const bookings = pgTable("bookings", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id", { length: 20 }).notNull().unique(),
  name: text("name").notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  category: varchar("category", { length: 50 }).notNull(),
  mode: varchar("mode", { length: 20 }).notNull(),
  paymentStatus: varchar("payment_status", { length: 20 }).notNull().default("PENDING"),
  sessionStatus: varchar("session_status", { length: 20 }).notNull().default("pending"),
  expertId: integer("expert_id"),
  assignedAt: timestamp("assigned_at"),
  completedAt: timestamp("completed_at"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export const insertBookingSchema = createInsertSchema(bookings, {
  name: z.string().min(2, "Name must be at least 2 characters"),
  phone: z.string().min(10, "Phone number must be at least 10 digits"),
  category: z.enum(["crop", "soil", "water", "fruit-veg", "cattle"]),
  mode: z.enum(["call", "chat", "video"]),
  paymentStatus: z.enum(["PENDING", "PAID", "FAILED"]).optional(),
}).omit({
  id: true,
  timestamp: true,
  sessionStatus: true,
  expertId: true,
  assignedAt: true,
  completedAt: true,
});

export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookings.$inferSelect;

// Login schemas
export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

// Advisory chat messages table
export const advisoryChats = pgTable("advisory_chats", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id", { length: 50 }).notNull(),
  role: varchar("role", { length: 20 }).notNull(), // 'user' or 'assistant'
  content: text("content").notNull(),
  category: varchar("category", { length: 50 }),
  advisoryType: varchar("advisory_type", { length: 20 }).default("general"), // 'crop', 'cattle', 'general'
  imageUrl: text("image_url"),
  diagnosis: text("diagnosis"), // For storing AI diagnosis results
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export const insertAdvisoryChatSchema = createInsertSchema(advisoryChats).omit({
  id: true,
  timestamp: true,
});

export type InsertAdvisoryChat = z.infer<typeof insertAdvisoryChatSchema>;
export type AdvisoryChat = typeof advisoryChats.$inferSelect;

// Advisory query schema for API
export const advisoryQuerySchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1, "Please enter your question"),
  category: z.enum(["crop", "soil", "pest", "disease", "irrigation"]).optional(),
  advisoryType: z.enum(["crop", "cattle", "soil", "water", "fruits", "general"]).optional(),
});

// Vision advisory schema for crop disease diagnosis
export const visionAdvisorySchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().optional(),
  advisoryType: z.enum(["crop", "cattle"]),
});

// Market prices table for live mandi data
export const marketPrices = pgTable("market_prices", {
  id: serial("id").primaryKey(),
  state: varchar("state", { length: 100 }).notNull(),
  district: varchar("district", { length: 100 }),
  market: varchar("market", { length: 100 }).notNull(),
  commodity: varchar("commodity", { length: 100 }).notNull(),
  variety: varchar("variety", { length: 100 }),
  minPrice: integer("min_price"),
  maxPrice: integer("max_price"),
  modalPrice: integer("modal_price"),
  priceDate: varchar("price_date", { length: 20 }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type MarketPrice = typeof marketPrices.$inferSelect;

// Weather data table
export const weatherData = pgTable("weather_data", {
  id: serial("id").primaryKey(),
  state: varchar("state", { length: 100 }).notNull(),
  district: varchar("district", { length: 100 }),
  temperature: integer("temperature"),
  humidity: integer("humidity"),
  rainfall: integer("rainfall"),
  condition: varchar("condition", { length: 100 }),
  forecast: text("forecast"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WeatherData = typeof weatherData.$inferSelect;

// Account Book - Expenses table
export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  farmerId: varchar("farmer_id", { length: 100 }).notNull().default("default"),
  category: varchar("category", { length: 50 }).notNull(),
  amount: integer("amount").notNull(),
  crop: varchar("crop", { length: 100 }),
  notes: text("notes"),
  photoUrl: text("photo_url"),
  date: timestamp("date").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertExpenseSchema = createInsertSchema(expenses).omit({
  id: true,
  createdAt: true,
});

export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expenses.$inferSelect;

// Account Book - Income table
export const incomes = pgTable("incomes", {
  id: serial("id").primaryKey(),
  farmerId: varchar("farmer_id", { length: 100 }).notNull().default("default"),
  category: varchar("category", { length: 50 }).notNull(),
  amount: integer("amount").notNull(),
  crop: varchar("crop", { length: 100 }),
  notes: text("notes"),
  quantity: integer("quantity"),
  unit: varchar("unit", { length: 20 }),
  date: timestamp("date").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertIncomeSchema = createInsertSchema(incomes).omit({
  id: true,
  createdAt: true,
});

export type InsertIncome = z.infer<typeof insertIncomeSchema>;
export type Income = typeof incomes.$inferSelect;

// Account Book - Crops tracking for cost per acre calculations
export const cropTracking = pgTable("crop_tracking", {
  id: serial("id").primaryKey(),
  farmerId: varchar("farmer_id", { length: 100 }).notNull().default("default"),
  cropName: varchar("crop_name", { length: 100 }).notNull(),
  landArea: integer("land_area"), // in bigha or acres
  areaUnit: varchar("area_unit", { length: 20 }).default("acre"),
  expectedYield: integer("expected_yield"), // in kg or quintal
  yieldUnit: varchar("yield_unit", { length: 20 }).default("quintal"),
  sowingDate: timestamp("sowing_date"),
  harvestDate: timestamp("harvest_date"),
  status: varchar("status", { length: 20 }).default("active"), // active, harvested, sold
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCropTrackingSchema = createInsertSchema(cropTracking).omit({
  id: true,
  createdAt: true,
});

export type InsertCropTracking = z.infer<typeof insertCropTrackingSchema>;
export type CropTracking = typeof cropTracking.$inferSelect;

// Expense categories enum for validation
export const expenseCategories = [
  "Seeds", "Fertilizer", "Pesticide", "Labour", "Diesel", 
  "Irrigation", "Electricity", "Transport", "Machinery Repair", 
  "Animal Feed", "Storage", "EMI", "Others"
] as const;

export const incomeCategories = [
  "Crop Sale", "Milk Sale", "Machinery Rental", 
  "Government Scheme", "Commodity Sale", "Animal Sale", "Others"
] as const;

// AI Expense analysis schema
export const expenseAnalysisSchema = z.object({
  farmerId: z.string().optional(),
  period: z.enum(["week", "month", "season", "year"]).optional(),
});

// ============ ONLINE LEARNING MODULE ============

// Learning categories
export const learningCategories = [
  "crop-management", "soil-health", "irrigation", "cattle-dairy",
  "market-trading", "govt-schemes", "machinery", "organic-farming",
  "fruits-vegetables", "weather-climate"
] as const;

// Learning content type
export const learningContentTypes = ["video", "audio"] as const;

// Learning content table (videos and audios) - IN-APP HOSTED
export const learningContent = pgTable("learning_content", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 20 }).notNull(), // 'video' or 'audio'
  title: varchar("title", { length: 200 }).notNull(),
  titleHindi: varchar("title_hindi", { length: 200 }),
  category: varchar("category", { length: 50 }).notNull(),
  description: text("description"),
  descriptionHindi: text("description_hindi"),
  duration: integer("duration"), // in seconds
  language: varchar("language", { length: 20 }).default("hindi"), // hindi, english, marathi
  thumbnailPath: text("thumbnail_path"), // local path: /uploads/thumbnails/xxx.jpg
  filePath: text("file_path").notNull(), // local path: /uploads/videos/xxx.mp4 or /uploads/audio/xxx.mp3
  fileSize: integer("file_size"), // in bytes
  mimeType: varchar("mime_type", { length: 50 }),
  transcript: text("transcript"),
  tags: text("tags"), // comma separated
  isDownloadable: boolean("is_downloadable").default(true),
  viewCount: integer("view_count").default(0),
  likeCount: integer("like_count").default(0),
  downloadCount: integer("download_count").default(0),
  isActive: boolean("is_active").default(true),
  uploadedByAdminId: integer("uploaded_by_admin_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLearningContentSchema = createInsertSchema(learningContent).omit({
  id: true,
  viewCount: true,
  likeCount: true,
  downloadCount: true,
  createdAt: true,
});

export type InsertLearningContent = z.infer<typeof insertLearningContentSchema>;
export type LearningContent = typeof learningContent.$inferSelect;

// Live workshops table
export const workshops = pgTable("workshops", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  titleHindi: varchar("title_hindi", { length: 200 }),
  description: text("description"),
  descriptionHindi: text("description_hindi"),
  category: varchar("category", { length: 50 }).notNull(),
  trainerName: varchar("trainer_name", { length: 100 }).notNull(),
  trainerNameHindi: varchar("trainer_name_hindi", { length: 100 }),
  scheduledAt: timestamp("scheduled_at").notNull(),
  durationMinutes: integer("duration_minutes").default(60),
  language: varchar("language", { length: 20 }).default("hindi"),
  maxSeats: integer("max_seats").default(100),
  registeredCount: integer("registered_count").default(0),
  joinLink: text("join_link"), // YouTube Live, Meet, Zoom link
  joinMethod: varchar("join_method", { length: 20 }).default("youtube"), // youtube, meet, zoom
  thumbnailUrl: text("thumbnail_url"),
  recordingUrl: text("recording_url"), // After workshop ends
  status: varchar("status", { length: 20 }).default("upcoming"), // upcoming, live, completed, cancelled
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertWorkshopSchema = createInsertSchema(workshops).omit({
  id: true,
  registeredCount: true,
  status: true,
  createdAt: true,
});

export type InsertWorkshop = z.infer<typeof insertWorkshopSchema>;
export type Workshop = typeof workshops.$inferSelect;

// Workshop registrations
export const workshopRegistrations = pgTable("workshop_registrations", {
  id: serial("id").primaryKey(),
  workshopId: integer("workshop_id").notNull(),
  farmerId: varchar("farmer_id", { length: 100 }).notNull().default("default"),
  farmerName: varchar("farmer_name", { length: 100 }),
  farmerPhone: varchar("farmer_phone", { length: 20 }),
  attended: boolean("attended").default(false),
  registeredAt: timestamp("registered_at").notNull().defaultNow(),
});

export const insertWorkshopRegistrationSchema = createInsertSchema(workshopRegistrations).omit({
  id: true,
  attended: true,
  registeredAt: true,
});

export type InsertWorkshopRegistration = z.infer<typeof insertWorkshopRegistrationSchema>;
export type WorkshopRegistration = typeof workshopRegistrations.$inferSelect;

// User learning progress
export const learningProgress = pgTable("learning_progress", {
  id: serial("id").primaryKey(),
  farmerId: varchar("farmer_id", { length: 100 }).notNull().default("default"),
  contentId: integer("content_id").notNull(),
  contentType: varchar("content_type", { length: 20 }).notNull(), // video, audio
  watchedSeconds: integer("watched_seconds").default(0),
  totalSeconds: integer("total_seconds").default(0),
  completedPercent: integer("completed_percent").default(0),
  isCompleted: boolean("is_completed").default(false),
  isBookmarked: boolean("is_bookmarked").default(false),
  isDownloaded: boolean("is_downloaded").default(false),
  lastWatchedAt: timestamp("last_watched_at").defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLearningProgressSchema = createInsertSchema(learningProgress).omit({
  id: true,
  createdAt: true,
});

export type InsertLearningProgress = z.infer<typeof insertLearningProgressSchema>;
export type LearningProgress = typeof learningProgress.$inferSelect;
