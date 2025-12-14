import { motion } from "framer-motion";
import { ArrowLeft, Info, Leaf, Users, Target, Award, Heart } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-green-50">
      <nav className="bg-white/90 backdrop-blur-sm border-b border-emerald-100 sticky top-0 z-40">
        <div className="container mx-auto px-4 h-16 flex items-center">
          <Link href="/">
            <Button variant="ghost" size="icon" className="mr-2 h-12 w-12" data-testid="button-back">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-purple-500 to-purple-600 text-white p-2 rounded-xl">
              <Info size={24} />
            </div>
            <div>
              <h1 className="font-heading font-bold text-lg text-foreground leading-tight">About Us</h1>
              <p className="text-sm text-muted-foreground">हमारे बारे में</p>
            </div>
          </div>
        </div>
      </nav>

      <div className="container mx-auto px-4 py-6 max-w-2xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="bg-gradient-to-br from-emerald-500 to-green-600 rounded-3xl p-8 text-center text-white">
            <div className="w-20 h-20 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Leaf className="w-10 h-10" />
            </div>
            <h2 className="text-3xl font-bold mb-2">KisanDecks</h2>
            <p className="text-emerald-100">Empowering Indian Farmers</p>
            <p className="text-emerald-200 text-sm mt-2">भारतीय किसानों को सशक्त बनाना</p>
          </div>

          <div className="bg-white rounded-3xl shadow-lg p-6 space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 flex-shrink-0">
                <Target className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg mb-2">Our Mission / हमारा लक्ष्य</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  To provide every Indian farmer access to expert agricultural guidance, 
                  modern farming techniques, and real-time market information - all in their 
                  local language and at affordable prices.
                </p>
                <p className="text-gray-500 text-sm mt-2">
                  हर भारतीय किसान को कृषि विशेषज्ञों की सलाह, आधुनिक खेती तकनीक, 
                  और बाजार की जानकारी उनकी भाषा में उपलब्ध कराना।
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 flex-shrink-0">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg mb-2">Who We Are / हम कौन हैं</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  KisanDecks is a team of agricultural experts, technologists, and farmers 
                  working together to bridge the knowledge gap in Indian agriculture. 
                  Our platform connects farmers directly with domain experts.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 flex-shrink-0">
                <Award className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg mb-2">Our Services / हमारी सेवाएं</h3>
                <ul className="text-gray-600 text-sm space-y-2">
                  <li>• Expert Consulting via Video, Phone & Chat</li>
                  <li>• AI-Powered Farming Advisory</li>
                  <li>• Live Weather Updates</li>
                  <li>• APMC Mandi Price Tracking</li>
                  <li>• Farmer Account Book (Khata)</li>
                  <li>• Smart Farming Calculators</li>
                  <li>• Online Learning Modules</li>
                </ul>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-pink-100 rounded-xl flex items-center justify-center text-pink-600 flex-shrink-0">
                <Heart className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg mb-2">Our Values / हमारे मूल्य</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  We believe in farmer-first approach, transparency, affordability, 
                  and continuous innovation to support the backbone of our nation - 
                  the Indian farmer.
                </p>
              </div>
            </div>
          </div>

        </motion.div>
      </div>
    </div>
  );
}
