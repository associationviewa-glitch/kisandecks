import { type User, type InsertUser, type Booking, type InsertBooking, type Admin, type InsertAdmin, type Expert, type InsertExpert, type AdvisoryChat, type InsertAdvisoryChat, type MarketPrice, type WeatherData, type Expense, type InsertExpense, type Income, type InsertIncome, type CropTracking, type InsertCropTracking, type LearningContent, type InsertLearningContent, type Workshop, type InsertWorkshop, type WorkshopRegistration, type InsertWorkshopRegistration, type LearningProgress, type InsertLearningProgress, type Farmer, type InsertFarmer, type ContentShare, users, bookings, admins, experts, advisoryChats, marketPrices, weatherData, expenses, incomes, cropTracking, learningContent, workshops, workshopRegistrations, learningProgress, farmers, contentShares } from "@shared/schema";
import { eq, desc, and, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

const { Pool } = pg;

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Admins
  getAdminByUsername(username: string): Promise<Admin | undefined>;
  getAdminById(id: number): Promise<Admin | undefined>;
  createAdmin(admin: InsertAdmin): Promise<Admin>;
  
  // Experts
  getExpertByUsername(username: string): Promise<Expert | undefined>;
  getExpertById(id: number): Promise<Expert | undefined>;
  getAllExperts(): Promise<Expert[]>;
  createExpert(expert: InsertExpert): Promise<Expert>;
  updateExpertStatus(id: number, status: string): Promise<Expert | undefined>;
  updateExpertActive(id: number, isActive: boolean): Promise<Expert | undefined>;
  updateExpertPassword(id: number, password: string): Promise<Expert | undefined>;
  deleteExpert(id: number): Promise<void>;
  
  // Bookings
  createBooking(booking: InsertBooking): Promise<Booking>;
  getBookingBySessionId(sessionId: string): Promise<Booking | undefined>;
  getBookingById(id: number): Promise<Booking | undefined>;
  getAllBookings(): Promise<Booking[]>;
  getBookingsByExpertId(expertId: number): Promise<Booking[]>;
  updateBookingPaymentStatus(sessionId: string, status: "PENDING" | "PAID" | "FAILED"): Promise<Booking | undefined>;
  assignExpertToBooking(bookingId: number, expertId: number): Promise<Booking | undefined>;
  updateBookingSessionStatus(bookingId: number, status: string): Promise<Booking | undefined>;
  
  // Advisory Chats
  createAdvisoryChat(chat: InsertAdvisoryChat): Promise<AdvisoryChat>;
  getAdvisoryChatsBySession(sessionId: string): Promise<AdvisoryChat[]>;
  
  // Market Prices
  upsertMarketPrice(price: Omit<MarketPrice, 'id' | 'updatedAt'>): Promise<MarketPrice>;
  getMarketPricesByCommodity(commodity: string): Promise<MarketPrice[]>;
  getLatestMarketPrices(limit?: number): Promise<MarketPrice[]>;
  
  // Weather Data
  upsertWeatherData(weather: Omit<WeatherData, 'id' | 'updatedAt'>): Promise<WeatherData>;
  getWeatherByState(state: string): Promise<WeatherData | undefined>;
  
  // Account Book - Expenses
  createExpense(expense: InsertExpense): Promise<Expense>;
  getExpensesByFarmer(farmerId: string, startDate?: Date, endDate?: Date): Promise<Expense[]>;
  getExpenseById(id: number): Promise<Expense | undefined>;
  updateExpense(id: number, expense: Partial<InsertExpense>): Promise<Expense | undefined>;
  deleteExpense(id: number): Promise<void>;
  
  // Account Book - Income
  createIncome(income: InsertIncome): Promise<Income>;
  getIncomesByFarmer(farmerId: string, startDate?: Date, endDate?: Date): Promise<Income[]>;
  getIncomeById(id: number): Promise<Income | undefined>;
  updateIncome(id: number, income: Partial<InsertIncome>): Promise<Income | undefined>;
  deleteIncome(id: number): Promise<void>;
  
  // Account Book - Crop Tracking
  createCropTracking(crop: InsertCropTracking): Promise<CropTracking>;
  getCropsByFarmer(farmerId: string): Promise<CropTracking[]>;
  getCropById(id: number): Promise<CropTracking | undefined>;
  updateCrop(id: number, crop: Partial<InsertCropTracking>): Promise<CropTracking | undefined>;
  deleteCrop(id: number): Promise<void>;
  
  // Account Book - Summaries
  getExpenseSummaryByCategory(farmerId: string, startDate?: Date, endDate?: Date): Promise<{category: string, total: number}[]>;
  getIncomeSummaryByCategory(farmerId: string, startDate?: Date, endDate?: Date): Promise<{category: string, total: number}[]>;
  getCropWiseExpenses(farmerId: string, cropName: string): Promise<{category: string, total: number}[]>;
  
  // Learning Module
  getLearningContent(type?: string, category?: string, query?: string): Promise<LearningContent[]>;
  getLearningContentById(id: number): Promise<LearningContent | undefined>;
  createLearningContent(content: InsertLearningContent): Promise<LearningContent>;
  incrementViewCount(id: number): Promise<void>;
  
  // Workshops
  getWorkshops(): Promise<Workshop[]>;
  getWorkshopById(id: number): Promise<Workshop | undefined>;
  createWorkshop(workshop: InsertWorkshop): Promise<Workshop>;
  registerForWorkshop(registration: InsertWorkshopRegistration): Promise<WorkshopRegistration>;
  getWorkshopRegistrations(workshopId: number): Promise<WorkshopRegistration[]>;
  isUserRegistered(workshopId: number, farmerId: string): Promise<boolean>;
  
  // Learning Progress
  getLearningProgress(farmerId: string): Promise<LearningProgress[]>;
  upsertLearningProgress(progress: InsertLearningProgress): Promise<LearningProgress>;
  bookmarkContent(farmerId: string, contentId: number, contentType: string): Promise<LearningProgress>;
  getBookmarkedContent(farmerId: string): Promise<any[]>;
  
  // Farmer Authentication
  getFarmerByPhone(phone: string): Promise<Farmer | undefined>;
  getFarmerById(id: number): Promise<Farmer | undefined>;
  createFarmer(farmer: InsertFarmer): Promise<Farmer>;
  updateFarmerLastLogin(id: number): Promise<void>;
  updateFarmerPassword(id: number, password: string): Promise<void>;
  updateFarmerProfile(id: number, data: { name?: string; email?: string; village?: string; district?: string; state?: string; language?: string; profilePhoto?: string }): Promise<void>;
  deleteFarmer(id: number): Promise<void>;
  
  // Content Sharing
  createContentShare(share: Omit<ContentShare, 'id' | 'createdAt' | 'accessCount'>): Promise<ContentShare>;
  getContentShareByToken(token: string): Promise<ContentShare | undefined>;
  incrementShareAccessCount(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  private db;

  constructor() {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    this.db = drizzle(pool);
  }

  // Users
  async getUser(id: string): Promise<User | undefined> {
    const result = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await this.db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await this.db.insert(users).values(insertUser).returning();
    return result[0];
  }

  // Admins
  async getAdminByUsername(username: string): Promise<Admin | undefined> {
    const result = await this.db.select().from(admins).where(eq(admins.username, username)).limit(1);
    return result[0];
  }

  async getAdminById(id: number): Promise<Admin | undefined> {
    const result = await this.db.select().from(admins).where(eq(admins.id, id)).limit(1);
    return result[0];
  }

  async createAdmin(admin: InsertAdmin): Promise<Admin> {
    const result = await this.db.insert(admins).values(admin).returning();
    return result[0];
  }

  // Experts
  async getExpertByUsername(username: string): Promise<Expert | undefined> {
    const result = await this.db.select().from(experts).where(eq(experts.username, username)).limit(1);
    return result[0];
  }

  async getExpertById(id: number): Promise<Expert | undefined> {
    const result = await this.db.select().from(experts).where(eq(experts.id, id)).limit(1);
    return result[0];
  }

  async getAllExperts(): Promise<Expert[]> {
    const result = await this.db.select().from(experts).orderBy(desc(experts.createdAt));
    return result;
  }

  async createExpert(expert: InsertExpert): Promise<Expert> {
    const result = await this.db.insert(experts).values(expert).returning();
    return result[0];
  }

  async updateExpertStatus(id: number, status: string): Promise<Expert | undefined> {
    const result = await this.db.update(experts).set({ status }).where(eq(experts.id, id)).returning();
    return result[0];
  }

  async updateExpertActive(id: number, isActive: boolean): Promise<Expert | undefined> {
    const result = await this.db.update(experts).set({ isActive }).where(eq(experts.id, id)).returning();
    return result[0];
  }

  async updateExpertPassword(id: number, password: string): Promise<Expert | undefined> {
    const result = await this.db.update(experts).set({ password }).where(eq(experts.id, id)).returning();
    return result[0];
  }

  async deleteExpert(id: number): Promise<void> {
    await this.db.delete(experts).where(eq(experts.id, id));
  }

  // Bookings
  async createBooking(booking: InsertBooking): Promise<Booking> {
    const result = await this.db.insert(bookings).values(booking).returning();
    return result[0];
  }

  async getBookingBySessionId(sessionId: string): Promise<Booking | undefined> {
    const result = await this.db.select().from(bookings).where(eq(bookings.sessionId, sessionId)).limit(1);
    return result[0];
  }

  async getBookingById(id: number): Promise<Booking | undefined> {
    const result = await this.db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    return result[0];
  }

  async getAllBookings(): Promise<Booking[]> {
    const result = await this.db.select().from(bookings).orderBy(desc(bookings.timestamp));
    return result;
  }

  async getBookingsByExpertId(expertId: number): Promise<Booking[]> {
    const result = await this.db.select().from(bookings).where(eq(bookings.expertId, expertId)).orderBy(desc(bookings.timestamp));
    return result;
  }

  async updateBookingPaymentStatus(sessionId: string, status: "PENDING" | "PAID" | "FAILED"): Promise<Booking | undefined> {
    const result = await this.db
      .update(bookings)
      .set({ paymentStatus: status })
      .where(eq(bookings.sessionId, sessionId))
      .returning();
    return result[0];
  }

  async assignExpertToBooking(bookingId: number, expertId: number): Promise<Booking | undefined> {
    const result = await this.db
      .update(bookings)
      .set({ expertId, assignedAt: new Date(), sessionStatus: "assigned" })
      .where(eq(bookings.id, bookingId))
      .returning();
    return result[0];
  }

  async updateBookingSessionStatus(bookingId: number, status: string): Promise<Booking | undefined> {
    const updates: Record<string, any> = { sessionStatus: status };
    if (status === "completed") {
      updates.completedAt = new Date();
    }
    const result = await this.db
      .update(bookings)
      .set(updates)
      .where(eq(bookings.id, bookingId))
      .returning();
    return result[0];
  }

  // Advisory Chats
  async createAdvisoryChat(chat: InsertAdvisoryChat): Promise<AdvisoryChat> {
    const result = await this.db.insert(advisoryChats).values(chat).returning();
    return result[0];
  }

  async getAdvisoryChatsBySession(sessionId: string): Promise<AdvisoryChat[]> {
    const result = await this.db.select().from(advisoryChats).where(eq(advisoryChats.sessionId, sessionId)).orderBy(advisoryChats.timestamp);
    return result;
  }

  // Market Prices
  async upsertMarketPrice(price: Omit<MarketPrice, 'id' | 'updatedAt'>): Promise<MarketPrice> {
    const existing = await this.db.select().from(marketPrices)
      .where(and(
        eq(marketPrices.state, price.state),
        eq(marketPrices.market, price.market),
        eq(marketPrices.commodity, price.commodity),
        price.priceDate ? eq(marketPrices.priceDate, price.priceDate) : sql`TRUE`
      ))
      .limit(1);
    
    if (existing.length > 0) {
      const updated = await this.db.update(marketPrices)
        .set({ ...price, updatedAt: new Date() })
        .where(eq(marketPrices.id, existing[0].id))
        .returning();
      return updated[0];
    }
    
    const result = await this.db.insert(marketPrices).values(price).returning();
    return result[0];
  }

  async getMarketPricesByCommodity(commodity: string): Promise<MarketPrice[]> {
    const result = await this.db.select().from(marketPrices)
      .where(sql`LOWER(${marketPrices.commodity}) LIKE LOWER(${'%' + commodity + '%'})`)
      .orderBy(desc(marketPrices.updatedAt))
      .limit(20);
    return result;
  }

  async getLatestMarketPrices(limit: number = 50): Promise<MarketPrice[]> {
    const result = await this.db.select().from(marketPrices)
      .orderBy(desc(marketPrices.updatedAt))
      .limit(limit);
    return result;
  }

  // Weather Data
  async upsertWeatherData(weather: Omit<WeatherData, 'id' | 'updatedAt'>): Promise<WeatherData> {
    const existing = await this.db.select().from(weatherData)
      .where(and(
        eq(weatherData.state, weather.state),
        weather.district ? eq(weatherData.district, weather.district) : sql`${weatherData.district} IS NULL`
      ))
      .limit(1);
    
    if (existing.length > 0) {
      const updated = await this.db.update(weatherData)
        .set({ ...weather, updatedAt: new Date() })
        .where(eq(weatherData.id, existing[0].id))
        .returning();
      return updated[0];
    }
    
    const result = await this.db.insert(weatherData).values(weather).returning();
    return result[0];
  }

  async getWeatherByState(state: string): Promise<WeatherData | undefined> {
    const result = await this.db.select().from(weatherData)
      .where(sql`LOWER(${weatherData.state}) LIKE LOWER(${'%' + state + '%'})`)
      .orderBy(desc(weatherData.updatedAt))
      .limit(1);
    return result[0];
  }

  // Account Book - Expenses
  async createExpense(expense: InsertExpense): Promise<Expense> {
    const result = await this.db.insert(expenses).values(expense).returning();
    return result[0];
  }

  async getExpensesByFarmer(farmerId: string, startDate?: Date, endDate?: Date): Promise<Expense[]> {
    let conditions = [eq(expenses.farmerId, farmerId)];
    if (startDate) {
      conditions.push(sql`${expenses.date} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${expenses.date} <= ${endDate}`);
    }
    const result = await this.db.select().from(expenses)
      .where(and(...conditions))
      .orderBy(desc(expenses.date));
    return result;
  }

  async getExpenseById(id: number): Promise<Expense | undefined> {
    const result = await this.db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
    return result[0];
  }

  async updateExpense(id: number, expense: Partial<InsertExpense>): Promise<Expense | undefined> {
    const result = await this.db.update(expenses).set(expense).where(eq(expenses.id, id)).returning();
    return result[0];
  }

  async deleteExpense(id: number): Promise<void> {
    await this.db.delete(expenses).where(eq(expenses.id, id));
  }

  // Account Book - Income
  async createIncome(income: InsertIncome): Promise<Income> {
    const result = await this.db.insert(incomes).values(income).returning();
    return result[0];
  }

  async getIncomesByFarmer(farmerId: string, startDate?: Date, endDate?: Date): Promise<Income[]> {
    let conditions = [eq(incomes.farmerId, farmerId)];
    if (startDate) {
      conditions.push(sql`${incomes.date} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${incomes.date} <= ${endDate}`);
    }
    const result = await this.db.select().from(incomes)
      .where(and(...conditions))
      .orderBy(desc(incomes.date));
    return result;
  }

  async getIncomeById(id: number): Promise<Income | undefined> {
    const result = await this.db.select().from(incomes).where(eq(incomes.id, id)).limit(1);
    return result[0];
  }

  async updateIncome(id: number, income: Partial<InsertIncome>): Promise<Income | undefined> {
    const result = await this.db.update(incomes).set(income).where(eq(incomes.id, id)).returning();
    return result[0];
  }

  async deleteIncome(id: number): Promise<void> {
    await this.db.delete(incomes).where(eq(incomes.id, id));
  }

  // Account Book - Crop Tracking
  async createCropTracking(crop: InsertCropTracking): Promise<CropTracking> {
    const result = await this.db.insert(cropTracking).values(crop).returning();
    return result[0];
  }

  async getCropsByFarmer(farmerId: string): Promise<CropTracking[]> {
    const result = await this.db.select().from(cropTracking)
      .where(eq(cropTracking.farmerId, farmerId))
      .orderBy(desc(cropTracking.createdAt));
    return result;
  }

  async getCropById(id: number): Promise<CropTracking | undefined> {
    const result = await this.db.select().from(cropTracking).where(eq(cropTracking.id, id)).limit(1);
    return result[0];
  }

  async updateCrop(id: number, crop: Partial<InsertCropTracking>): Promise<CropTracking | undefined> {
    const result = await this.db.update(cropTracking).set(crop).where(eq(cropTracking.id, id)).returning();
    return result[0];
  }

  async deleteCrop(id: number): Promise<void> {
    await this.db.delete(cropTracking).where(eq(cropTracking.id, id));
  }

  // Account Book - Summaries
  async getExpenseSummaryByCategory(farmerId: string, startDate?: Date, endDate?: Date): Promise<{category: string, total: number}[]> {
    let conditions = [eq(expenses.farmerId, farmerId)];
    if (startDate) {
      conditions.push(sql`${expenses.date} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${expenses.date} <= ${endDate}`);
    }
    const result = await this.db.select({
      category: expenses.category,
      total: sql<number>`SUM(${expenses.amount})`.as('total')
    }).from(expenses)
      .where(and(...conditions))
      .groupBy(expenses.category);
    return result.map(r => ({ category: r.category, total: Number(r.total) }));
  }

  async getIncomeSummaryByCategory(farmerId: string, startDate?: Date, endDate?: Date): Promise<{category: string, total: number}[]> {
    let conditions = [eq(incomes.farmerId, farmerId)];
    if (startDate) {
      conditions.push(sql`${incomes.date} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${incomes.date} <= ${endDate}`);
    }
    const result = await this.db.select({
      category: incomes.category,
      total: sql<number>`SUM(${incomes.amount})`.as('total')
    }).from(incomes)
      .where(and(...conditions))
      .groupBy(incomes.category);
    return result.map(r => ({ category: r.category, total: Number(r.total) }));
  }

  async getCropWiseExpenses(farmerId: string, cropName: string): Promise<{category: string, total: number}[]> {
    const result = await this.db.select({
      category: expenses.category,
      total: sql<number>`SUM(${expenses.amount})`.as('total')
    }).from(expenses)
      .where(and(
        eq(expenses.farmerId, farmerId),
        sql`LOWER(${expenses.crop}) = LOWER(${cropName})`
      ))
      .groupBy(expenses.category);
    return result.map(r => ({ category: r.category, total: Number(r.total) }));
  }

  // ============ LEARNING MODULE ============

  async getLearningContent(type?: string, category?: string, query?: string): Promise<LearningContent[]> {
    let conditions: any[] = [eq(learningContent.isActive, true)];
    if (type) conditions.push(eq(learningContent.type, type));
    if (category) conditions.push(eq(learningContent.category, category));
    
    let result = await this.db.select()
      .from(learningContent)
      .where(and(...conditions))
      .orderBy(desc(learningContent.createdAt));
    
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(item => 
        item.title.toLowerCase().includes(q) ||
        item.titleHindi?.toLowerCase().includes(q) ||
        item.tags?.toLowerCase().includes(q)
      );
    }
    return result;
  }

  async getLearningContentById(id: number): Promise<LearningContent | undefined> {
    const result = await this.db.select().from(learningContent).where(eq(learningContent.id, id)).limit(1);
    return result[0];
  }

  async createLearningContent(content: InsertLearningContent): Promise<LearningContent> {
    const result = await this.db.insert(learningContent).values(content).returning();
    return result[0];
  }

  async incrementViewCount(id: number): Promise<void> {
    await this.db.update(learningContent)
      .set({ viewCount: sql`${learningContent.viewCount} + 1` })
      .where(eq(learningContent.id, id));
  }

  // Workshops
  async getWorkshops(): Promise<Workshop[]> {
    return await this.db.select()
      .from(workshops)
      .where(eq(workshops.isActive, true))
      .orderBy(desc(workshops.scheduledAt));
  }

  async getWorkshopById(id: number): Promise<Workshop | undefined> {
    const result = await this.db.select().from(workshops).where(eq(workshops.id, id)).limit(1);
    return result[0];
  }

  async createWorkshop(workshop: InsertWorkshop): Promise<Workshop> {
    const result = await this.db.insert(workshops).values(workshop).returning();
    return result[0];
  }

  async registerForWorkshop(registration: InsertWorkshopRegistration): Promise<WorkshopRegistration> {
    const result = await this.db.insert(workshopRegistrations).values(registration).returning();
    // Update registered count
    await this.db.update(workshops)
      .set({ registeredCount: sql`${workshops.registeredCount} + 1` })
      .where(eq(workshops.id, registration.workshopId));
    return result[0];
  }

  async getWorkshopRegistrations(workshopId: number): Promise<WorkshopRegistration[]> {
    return await this.db.select()
      .from(workshopRegistrations)
      .where(eq(workshopRegistrations.workshopId, workshopId));
  }

  async isUserRegistered(workshopId: number, farmerId: string): Promise<boolean> {
    const result = await this.db.select()
      .from(workshopRegistrations)
      .where(and(
        eq(workshopRegistrations.workshopId, workshopId),
        eq(workshopRegistrations.farmerId, farmerId)
      ))
      .limit(1);
    return result.length > 0;
  }

  // Learning Progress
  async getLearningProgress(farmerId: string): Promise<LearningProgress[]> {
    return await this.db.select()
      .from(learningProgress)
      .where(eq(learningProgress.farmerId, farmerId))
      .orderBy(desc(learningProgress.lastWatchedAt));
  }

  async upsertLearningProgress(progress: InsertLearningProgress): Promise<LearningProgress> {
    // Check if progress exists
    const existing = await this.db.select()
      .from(learningProgress)
      .where(and(
        eq(learningProgress.farmerId, progress.farmerId || "default"),
        eq(learningProgress.contentId, progress.contentId),
        eq(learningProgress.contentType, progress.contentType)
      ))
      .limit(1);
    
    if (existing.length > 0) {
      const result = await this.db.update(learningProgress)
        .set({
          ...progress,
          lastWatchedAt: new Date()
        })
        .where(eq(learningProgress.id, existing[0].id))
        .returning();
      return result[0];
    } else {
      const result = await this.db.insert(learningProgress).values(progress).returning();
      return result[0];
    }
  }

  async bookmarkContent(farmerId: string, contentId: number, contentType: string): Promise<LearningProgress> {
    const existing = await this.db.select()
      .from(learningProgress)
      .where(and(
        eq(learningProgress.farmerId, farmerId),
        eq(learningProgress.contentId, contentId),
        eq(learningProgress.contentType, contentType)
      ))
      .limit(1);
    
    if (existing.length > 0) {
      const result = await this.db.update(learningProgress)
        .set({ isBookmarked: !existing[0].isBookmarked })
        .where(eq(learningProgress.id, existing[0].id))
        .returning();
      return result[0];
    } else {
      const result = await this.db.insert(learningProgress).values({
        farmerId,
        contentId,
        contentType,
        isBookmarked: true,
      }).returning();
      return result[0];
    }
  }

  async getBookmarkedContent(farmerId: string): Promise<any[]> {
    const progress = await this.db.select()
      .from(learningProgress)
      .where(and(
        eq(learningProgress.farmerId, farmerId),
        eq(learningProgress.isBookmarked, true)
      ))
      .orderBy(desc(learningProgress.lastWatchedAt));
    
    // Fetch content details for each bookmarked item
    const results = [];
    for (const p of progress) {
      const content = await this.db.select()
        .from(learningContent)
        .where(eq(learningContent.id, p.contentId))
        .limit(1);
      if (content[0]) {
        results.push({
          ...p,
          title: content[0].title,
          titleHindi: content[0].titleHindi,
          thumbnailPath: content[0].thumbnailPath,
          duration: content[0].duration,
        });
      }
    }
    return results;
  }

  // ============ FARMER AUTHENTICATION ============

  async getFarmerByPhone(phone: string): Promise<Farmer | undefined> {
    const result = await this.db.select().from(farmers).where(eq(farmers.phone, phone)).limit(1);
    return result[0];
  }

  async getFarmerById(id: number): Promise<Farmer | undefined> {
    const result = await this.db.select().from(farmers).where(eq(farmers.id, id)).limit(1);
    return result[0];
  }

  async createFarmer(farmer: InsertFarmer): Promise<Farmer> {
    const result = await this.db.insert(farmers).values(farmer).returning();
    return result[0];
  }

  async updateFarmerLastLogin(id: number): Promise<void> {
    await this.db.update(farmers)
      .set({ lastLoginAt: new Date() })
      .where(eq(farmers.id, id));
  }

  async updateFarmerPassword(id: number, password: string): Promise<void> {
    await this.db.update(farmers)
      .set({ password })
      .where(eq(farmers.id, id));
  }

  async updateFarmerProfile(id: number, data: { name?: string; email?: string; village?: string; district?: string; state?: string; language?: string; profilePhoto?: string }): Promise<void> {
    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.email) updateData.email = data.email;
    if (data.village) updateData.village = data.village;
    if (data.district) updateData.district = data.district;
    if (data.state) updateData.state = data.state;
    if (data.language) updateData.language = data.language;
    if (data.profilePhoto) updateData.profilePhoto = data.profilePhoto;
    
    if (Object.keys(updateData).length > 0) {
      await this.db.update(farmers)
        .set(updateData)
        .where(eq(farmers.id, id));
    }
  }

  async deleteFarmer(id: number): Promise<void> {
    await this.db.delete(farmers).where(eq(farmers.id, id));
  }

  // ============ CONTENT SHARING ============

  async createContentShare(share: Omit<ContentShare, 'id' | 'createdAt' | 'accessCount'>): Promise<ContentShare> {
    const result = await this.db.insert(contentShares).values(share as any).returning();
    return result[0];
  }

  async getContentShareByToken(token: string): Promise<ContentShare | undefined> {
    const result = await this.db.select()
      .from(contentShares)
      .where(eq(contentShares.shareToken, token))
      .limit(1);
    return result[0];
  }

  async incrementShareAccessCount(id: number): Promise<void> {
    await this.db.update(contentShares)
      .set({ accessCount: sql`${contentShares.accessCount} + 1` })
      .where(eq(contentShares.id, id));
  }
}

export const storage = new DatabaseStorage();
